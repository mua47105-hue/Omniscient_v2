// Grading Engine — closes the self-learning loop.
//
// When a Signal expires (status='open' AND expiresAt < now) we fetch the
// current price + historical klines, use triple-barrier labeling to determine
// the actual outcome (path-dependent, not just point-in-time), persist a
// SignalOutcome row, and mark the Signal as 'closed'.
//
// The triple-barrier method checks which barrier was hit FIRST:
//   - Stop-loss touched intra-window → wrong (even if price recovered by expiry)
//   - Take-profit touched intra-window → correct (even if price gave back gains)
//   - Neither touched → use the exit-time price to determine correct/wrong/partial
//
// This fixes the defect where a long signal that touched its SL mid-window
// and recovered above entry by expiry was graded "correct" — it was actually
// "wrong" (the stop was hit, the trade would have been closed at a loss).

import { db } from '@/lib/db';
import { getTicker24h, getKlines } from '@/lib/market/binance';
import { tripleBarrierLabel } from '@/lib/analysis/triple-barrier';
import type { Kline } from '@/lib/types';

export type Grade = 'correct' | 'wrong' | 'partial';
export type ActualDirection = 'long' | 'short' | 'flat';

export interface GradeResult {
  signalId: string;
  symbol: string;
  expected: string;
  actual: ActualDirection;
  grade: Grade;
  pnlPct: number;
  entryPrice: number | null;
  currentPrice: number;
  method: 'triple-barrier' | 'point-in-time';
}

export interface GradeSummary {
  graded: number;
  skipped: number;
  results: GradeResult[];
}

interface GradeableSignal {
  id: string;
  direction: string;
  timeframe: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  timestamp: Date;
  expiresAt: Date | null;
  asset: { symbol: string };
}

/**
 * Point-in-time evaluation (fallback when klines unavailable).
 * Same logic as before — single price snapshot at expiry.
 */
function evaluatePointInTime(
  direction: string,
  entry: number,
  current: number,
  stopLoss: number | null,
): { actual: ActualDirection; grade: Grade; pnlPct: number } {
  const movePct = ((current - entry) / entry) * 100;

  if (direction === 'long') {
    const pnlPct = movePct;
    if (current > entry) return { actual: 'long', grade: 'correct', pnlPct };
    if (stopLoss != null && current < stopLoss)
      return { actual: 'short', grade: 'wrong', pnlPct };
    return { actual: 'flat', grade: 'partial', pnlPct };
  }

  if (direction === 'short') {
    const pnlPct = -movePct;
    if (current < entry) return { actual: 'short', grade: 'correct', pnlPct };
    if (stopLoss != null && current > stopLoss)
      return { actual: 'long', grade: 'wrong', pnlPct };
    return { actual: 'flat', grade: 'partial', pnlPct };
  }

  const pnlPct = 0;
  if (Math.abs(movePct) < 2) return { actual: 'flat', grade: 'correct', pnlPct };
  return { actual: movePct > 0 ? 'long' : 'short', grade: 'partial', pnlPct };
}

/**
 * Triple-barrier evaluation (path-dependent).
 * Fetches klines covering the signal's lifetime, walks the path, and determines
 * which barrier (SL, TP, or timeout) was hit first.
 *
 * If SL was touched intra-window → wrong (even if price recovered by expiry).
 * If TP was touched intra-window → correct (even if price gave back gains).
 * If neither → fall back to point-in-time at the timeout bar's close.
 *
 * Returns null if klines can't be fetched (caller falls back to point-in-time).
 */
async function evaluateWithPath(
  direction: string,
  entry: number,
  stopLoss: number | null,
  takeProfit: number | null,
  assetSymbol: string,
  signalTimestamp: Date,
  expiresAt: Date,
): Promise<{ actual: ActualDirection; grade: Grade; pnlPct: number } | null> {
  // Only crypto assets have Binance klines.
  if (!assetSymbol.endsWith('USDT')) return null;

  try {
    const signalMs = signalTimestamp.getTime();
    const expiryMs = expiresAt.getTime();
    const hoursBetween = Math.max(1, Math.ceil((expiryMs - signalMs) / 3600000));
    const limit = Math.min(500, hoursBetween + 6);
    const klines: Kline[] = await getKlines(assetSymbol, '1h', limit);

    if (!klines || klines.length < 2) return null;

    // Find the entry bar.
    let entryIndex = klines.findIndex((k) => k.openTime >= signalMs);
    if (entryIndex < 0) entryIndex = 0;

    // Compute ATR from the klines (simple: average of last 14 bars' TR).
    const atrKlines = klines.slice(Math.max(0, entryIndex - 14), entryIndex + 1);
    let atrSum = 0;
    for (let i = 1; i < atrKlines.length; i++) {
      const k = atrKlines[i];
      const prev = atrKlines[i - 1];
      const tr = Math.max(
        k.high - k.low,
        Math.abs(k.high - prev.close),
        Math.abs(k.low - prev.close),
      );
      atrSum += tr;
    }
    const atr = atrKlines.length > 1 ? atrSum / (atrKlines.length - 1) : 0;
    if (atr <= 0) return null;

    // Convert signal's SL/TP to ATR multipliers for triple-barrier.
    const slDist = stopLoss != null ? Math.abs(entry - stopLoss) : 1.5 * atr;
    const tpDist = takeProfit != null ? Math.abs(takeProfit - entry) : 2 * atr;
    const slMult = slDist / atr;
    const tpMult = tpDist / atr;
    const holdingPeriod = Math.max(1, Math.ceil((expiryMs - signalMs) / 3600000));

    const tbDirection = direction === 'short' ? 'short' : 'long';
    const result = tripleBarrierLabel(entry, atr, klines, entryIndex, {
      stopLossAtr: slMult,
      takeProfitAtr: tpMult,
      timeoutBars: holdingPeriod,
      side: tbDirection as 'long' | 'short',
    });

    // Map triple-barrier label to grading terminology.
    if (result.label === 1) {
      return { actual: direction === 'short' ? 'short' : 'long', grade: 'correct', pnlPct: result.returnPct * 100 };
    }
    if (result.label === -1) {
      return { actual: direction === 'long' ? 'short' : 'long', grade: 'wrong', pnlPct: result.returnPct * 100 };
    }
    // Timeout: neither SL nor TP hit — use the exit-price (timeout bar close).
    return evaluatePointInTime(direction, entry, result.exitPrice, stopLoss);
  } catch {
    return null;
  }
}

export async function gradeExpiredSignals(): Promise<GradeSummary> {
  const now = new Date();
  const expired = await db.signal.findMany({
    where: {
      status: 'open',
      expiresAt: { lt: now },
    },
    include: { asset: { select: { symbol: true } } },
    orderBy: { expiresAt: 'asc' },
    take: 100,
  });

  const results: GradeResult[] = [];
  let skipped = 0;

  for (const sig of expired as GradeableSignal[]) {
    if (sig.entryPrice == null) {
      skipped++;
      continue;
    }
    try {
      const ticker = await getTicker24h(sig.asset.symbol);
      const current = ticker.price;

      // Try triple-barrier first (path-dependent), fall back to point-in-time.
      let gradeResult = await evaluateWithPath(
        sig.direction,
        sig.entryPrice,
        sig.stopLoss,
        sig.takeProfit,
        sig.asset.symbol,
        sig.timestamp,
        sig.expiresAt ?? now,
      );
      let method: 'triple-barrier' | 'point-in-time' = 'triple-barrier';
      if (gradeResult == null) {
        gradeResult = evaluatePointInTime(sig.direction, sig.entryPrice, current, sig.stopLoss);
        method = 'point-in-time';
      }

      const { actual, grade, pnlPct } = gradeResult;

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
        method,
      });
    } catch {
      skipped++;
    }
  }

  return { graded: results.length, skipped, results };
}
