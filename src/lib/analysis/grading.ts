// Grading Engine — closes the self-learning loop.
//
// When a Signal expires (status='open' AND expiresAt < now) we fetch the
// current price, compare it to the signal's direction/entry/stop, persist a
// SignalOutcome row, and mark the Signal as 'closed'. The accumulated
// outcomes power the model-accuracy analytics dashboard.

import { db } from '@/lib/db';
import { getTicker24h } from '@/lib/market/binance';

export type Grade = 'correct' | 'wrong' | 'partial';
export type ActualDirection = 'long' | 'short' | 'flat';

export interface GradeResult {
  signalId: string;
  symbol: string;
  expected: string; // long | short | neutral
  actual: ActualDirection;
  grade: Grade;
  pnlPct: number;
  entryPrice: number | null;
  currentPrice: number;
}

export interface GradeSummary {
  graded: number;
  skipped: number;
  results: GradeResult[];
}

/** Minimal projection of a Signal row used by the grading engine. */
interface GradeableSignal {
  id: string;
  direction: string;
  timeframe: string;
  entryPrice: number | null;
  stopLoss: number | null;
  asset: { symbol: string };
}

/**
 * Determine the actual market direction + grade for an expired signal.
 *
 * - Long expected: price up → correct; price below stop → wrong; in-between → partial.
 * - Short expected: inverse.
 * - Neutral expected: |move| < 2% → correct; else partial.
 *
 * `grade` is the correctness label ('correct'|'wrong'|'partial').
 * `actual` is the realized market direction ('long'|'short'|'flat') — stored in
 * SignalOutcome.actual (schema comment says "long | short | flat").
 */
function evaluate(
  direction: string,
  entry: number,
  current: number,
  stopLoss: number | null,
): { actual: ActualDirection; grade: Grade; pnlPct: number } {
  const movePct = ((current - entry) / entry) * 100; // +ve = price went up

  if (direction === 'long') {
    const pnlPct = movePct;
    if (current > entry) return { actual: 'long', grade: 'correct', pnlPct };
    if (stopLoss != null && current < stopLoss)
      return { actual: 'short', grade: 'wrong', pnlPct };
    return { actual: 'flat', grade: 'partial', pnlPct };
  }

  if (direction === 'short') {
    const pnlPct = -movePct; // short profits when price falls
    if (current < entry) return { actual: 'short', grade: 'correct', pnlPct };
    if (stopLoss != null && current > stopLoss)
      return { actual: 'long', grade: 'wrong', pnlPct };
    return { actual: 'flat', grade: 'partial', pnlPct };
  }

  // neutral — expected flat; correct if price barely moved
  const pnlPct = 0;
  if (Math.abs(movePct) < 2) return { actual: 'flat', grade: 'correct', pnlPct };
  return {
    actual: movePct > 0 ? 'long' : 'short',
    grade: 'partial',
    pnlPct,
  };
}

/**
 * Grade all expired open signals. Safe to call from API route or scheduler tick.
 * - Fetches current price per signal (try/catch — skip on failure).
 * - Persists a SignalOutcome row.
 * - Marks the Signal as 'closed'.
 */
export async function gradeExpiredSignals(): Promise<GradeSummary> {
  const now = new Date();
  const expired = await db.signal.findMany({
    where: {
      status: 'open',
      expiresAt: { lt: now },
    },
    include: { asset: { select: { symbol: true } } },
    orderBy: { expiresAt: 'asc' },
    take: 100, // cap per run to keep the request bounded
  });

  const results: GradeResult[] = [];
  let skipped = 0;

  for (const sig of expired as GradeableSignal[]) {
    // Need an entry price to grade against. Skip if missing.
    if (sig.entryPrice == null) {
      skipped++;
      continue;
    }
    try {
      const ticker = await getTicker24h(sig.asset.symbol);
      const current = ticker.price;
      const { actual, grade, pnlPct } = evaluate(
        sig.direction,
        sig.entryPrice,
        current,
        sig.stopLoss,
      );

      await db.signalOutcome.create({
        data: {
          signalId: sig.id,
          horizon: sig.timeframe,
          expected: sig.direction,
          actual,
          pnlPct,
          grade,
          gradedAt: now,
        },
      });
      await db.signal.update({
        where: { id: sig.id },
        data: { status: 'closed' },
      });

      results.push({
        signalId: sig.id,
        symbol: sig.asset.symbol,
        expected: sig.direction,
        actual,
        grade,
        pnlPct,
        entryPrice: sig.entryPrice,
        currentPrice: current,
      });
    } catch {
      // Price fetch failed (network, rate-limit, delisted symbol, …) — skip.
      skipped++;
    }
  }

  return { graded: results.length, skipped, results };
}
