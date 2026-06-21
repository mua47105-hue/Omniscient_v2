/**
 * Self-learning grading loop.
 *
 *  - Finds all OPEN signals whose `expiresAt` has passed.
 *  - Fetches the current price for the symbol (Binance for crypto, Yahoo for
 *    everything else).
 *  - Evaluates the outcome:
 *      long:    price > entry → correct;  price < stop → wrong; else partial
 *      short:   price < entry → correct;  price > stop → wrong; else partial
 *      neutral: |price - entry| / entry < 2% → correct; else wrong
 *  - Computes pnlPct: long  = (price - entry) / entry * 100
 *                     short = (entry - price) / entry * 100
 *                     neutral = 0
 *  - Creates a SignalOutcome row, marks the Signal as closed.
 *  - Returns {graded, skipped, results}.
 *
 *  This module is best-effort: a single failed price fetch should never
 *  block the rest of the loop. Each signal is graded independently inside
 *  try/catch.
 */
import db from '@/lib/db';
import { getTicker24h } from '@/lib/market/binance';
import { getMacroQuote } from '@/lib/market/macro';

export interface GradingResult {
  signalId: string;
  assetSymbol: string;
  direction: string;
  entryPrice: number | null;
  currentPrice: number | null;
  pnlPct: number | null;
  grade: 'correct' | 'wrong' | 'partial';
  error?: string;
}

export interface GradingSummary {
  graded: number;
  skipped: number;
  results: GradingResult[];
}

async function fetchCurrentPrice(symbol: string, assetClass?: string): Promise<number | null> {
  // Crypto → Binance.
  if (assetClass === 'crypto' || symbol.endsWith('USDT') || symbol.endsWith('USD')) {
    const binanceSymbol = symbol.toUpperCase().endsWith('USD') && !symbol.toUpperCase().endsWith('USDT')
      ? symbol.toUpperCase() + 'T' // BTCUSD → BTCUSDT (loose heuristic)
      : symbol.toUpperCase();
    try {
      const t = await getTicker24h(binanceSymbol);
      if (Number.isFinite(t.lastPrice) && t.lastPrice > 0) return t.lastPrice;
    } catch {
      /* fall through to Yahoo */
    }
  }
  // Forex / stocks / indices / commodities → Yahoo.
  try {
    const q = await getMacroQuote(symbol);
    if (q && Number.isFinite(q.price) && q.price > 0) return q.price;
  } catch {
    /* ignore */
  }
  return null;
}

function evaluate(
  direction: string,
  entry: number | null,
  stop: number | null,
  current: number,
): { grade: 'correct' | 'wrong' | 'partial'; pnlPct: number } {
  if (direction === 'long') {
    if (entry == null) return { grade: 'partial', pnlPct: 0 };
    const pnlPct = ((current - entry) / entry) * 100;
    if (stop != null && current <= stop) return { grade: 'wrong', pnlPct };
    if (current > entry) return { grade: 'correct', pnlPct };
    return { grade: 'partial', pnlPct };
  }
  if (direction === 'short') {
    if (entry == null) return { grade: 'partial', pnlPct: 0 };
    const pnlPct = ((entry - current) / entry) * 100;
    if (stop != null && current >= stop) return { grade: 'wrong', pnlPct };
    if (current < entry) return { grade: 'correct', pnlPct };
    return { grade: 'partial', pnlPct };
  }
  // neutral
  if (entry != null) {
    const move = Math.abs((current - entry) / entry) * 100;
    return { grade: move < 2 ? 'correct' : 'wrong', pnlPct: 0 };
  }
  return { grade: 'partial', pnlPct: 0 };
}

export async function gradeExpiredSignals(): Promise<GradingSummary> {
  const now = new Date();
  const results: GradingResult[] = [];
  let graded = 0;
  let skipped = 0;

  // Find all open signals that have expired.
  let expired: any[] = [];
  try {
    expired = await db.signal.findMany({
      where: {
        status: 'open',
        expiresAt: { lt: now },
      },
      include: { asset: true },
      take: 100,
    });
  } catch (err) {
    console.error('[grading] query failed:', err);
    return { graded: 0, skipped: 0, results: [] };
  }

  for (const sig of expired) {
    const assetSymbol = sig.asset?.symbol ?? '';
    const assetClass = sig.asset?.assetClass;
    try {
      if (!assetSymbol) {
        skipped++;
        continue;
      }
      const current = await fetchCurrentPrice(assetSymbol, assetClass);
      if (current == null || !Number.isFinite(current)) {
        results.push({
          signalId: sig.id,
          assetSymbol,
          direction: sig.direction,
          entryPrice: sig.entryPrice,
          currentPrice: null,
          pnlPct: null,
          grade: 'partial',
          error: 'price fetch failed',
        });
        skipped++;
        continue;
      }

      const { grade, pnlPct } = evaluate(sig.direction, sig.entryPrice, sig.stopLoss, current);

      await db.signalOutcome.create({
        data: {
          signalId: sig.id,
          horizon: sig.timeframe || '4h',
          expected: sig.direction,
          actual: grade === 'correct' ? sig.direction : grade === 'wrong' ? (sig.direction === 'long' ? 'short' : sig.direction === 'short' ? 'long' : 'neutral') : 'partial',
          pnlPct: Math.round(pnlPct * 100) / 100,
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
        assetSymbol,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        currentPrice: current,
        pnlPct: Math.round(pnlPct * 100) / 100,
        grade,
      });
      graded++;
    } catch (err) {
      console.error(`[grading] signal ${sig.id} failed:`, err);
      results.push({
        signalId: sig.id,
        assetSymbol,
        direction: sig.direction,
        entryPrice: sig.entryPrice,
        currentPrice: null,
        pnlPct: null,
        grade: 'partial',
        error: (err as Error).message,
      });
      skipped++;
    }
  }

  return { graded, skipped, results };
}
