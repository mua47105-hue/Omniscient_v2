/**
 * Multi-timeframe confluence API — computes indicators on 1h / 4h / 1d klines
 * for every active crypto asset and returns an alignment score for each.
 *
 * GET /api/multi-timeframe
 *
 * Alignment score:
 *   - For each timeframe, we get a direction from computeIndicators().summaryScore
 *     (sign: + = bullish, - = bearish, 0 = neutral).
 *   - alignmentScore = (count of agreeing timeframes / total timeframes) * 100
 *   - If all 3 agree → 100% confluence (strongest signal).
 *   - If 2 of 3 agree → ~67%.
 *   - direction = majority direction (long if 2+ bullish, short if 2+ bearish, else neutral).
 *
 * Returns one row per asset with per-timeframe trend + score + final confluence.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getKlines } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import type { TechnicalIndicators } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface TimeframeSnapshot {
  interval: '1h' | '4h' | '1d';
  trend: 'up' | 'down' | 'sideways';
  summaryScore: number;
  rsi14: number | null;
  macdHist: number | null;
}

interface ConfluenceRow {
  symbol: string;
  name: string;
  timeframes: TimeframeSnapshot[];
  alignmentScore: number; // 0..100
  direction: 'long' | 'short' | 'neutral';
  agreeCount: number;
  total: number;
}

async function fetchTimeframe(
  symbol: string,
  interval: '1h' | '4h' | '1d',
  limit: number,
): Promise<TechnicalIndicators | null> {
  try {
    const klines = await getKlines(symbol, interval, limit);
    if (klines.length < 30) return null;
    return computeIndicators(klines);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const assets = await db.asset.findMany({
      where: { assetClass: 'crypto', isActive: true },
      select: { symbol: true, name: true },
    });

    const rows: ConfluenceRow[] = [];

    await Promise.all(
      assets.map(async (a) => {
        const [t1h, t4h, t1d] = await Promise.all([
          fetchTimeframe(a.symbol, '1h', 200),
          fetchTimeframe(a.symbol, '4h', 200),
          fetchTimeframe(a.symbol, '1d', 200),
        ]);

        const snapshots: TimeframeSnapshot[] = [];
        for (const [interval, ind] of [
          ['1h', t1h],
          ['4h', t4h],
          ['1d', t1d],
        ] as const) {
          if (ind) {
            snapshots.push({
              interval,
              trend: ind.trend,
              summaryScore: ind.summaryScore,
              rsi14: ind.rsi14,
              macdHist: ind.macd.histogram,
            });
          }
        }

        if (snapshots.length === 0) return;

        // Direction per timeframe.
        const dirs = snapshots.map((s) => {
          if (s.summaryScore > 8) return 'long' as const;
          if (s.summaryScore < -8) return 'short' as const;
          return 'neutral' as const;
        });

        const longCount = dirs.filter((d) => d === 'long').length;
        const shortCount = dirs.filter((d) => d === 'short').length;
        const neutralCount = dirs.filter((d) => d === 'neutral').length;
        const total = dirs.length;

        let direction: 'long' | 'short' | 'neutral' = 'neutral';
        let agreeCount = 0;
        if (longCount > shortCount && longCount > neutralCount) {
          direction = 'long';
          agreeCount = longCount;
        } else if (shortCount > longCount && shortCount > neutralCount) {
          direction = 'short';
          agreeCount = shortCount;
        } else if (longCount === shortCount && longCount > 0) {
          // Split — call it neutral with no agreement.
          direction = 'neutral';
          agreeCount = Math.max(longCount, shortCount);
        } else {
          direction = 'neutral';
          agreeCount = neutralCount;
        }

        const alignmentScore = Math.round((agreeCount / total) * 100);

        rows.push({
          symbol: a.symbol,
          name: a.name,
          timeframes: snapshots,
          alignmentScore,
          direction,
          agreeCount,
          total,
        });
      }),
    );

    // Sort: highest confluence first; tie-break by direction (long > short > neutral).
    rows.sort((a, b) => {
      if (b.alignmentScore !== a.alignmentScore) return b.alignmentScore - a.alignmentScore;
      const dWeight = (d: string) => (d === 'long' ? 2 : d === 'short' ? 1 : 0);
      return dWeight(b.direction) - dWeight(a.direction);
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
