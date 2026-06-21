/**
 * Correlation returns API — fetches 30d daily log-returns for all active
 * crypto assets.
 *
 * GET /api/correlation/returns
 *
 * Returns { success: true, data: Record<symbol, number[]> } where each
 * array contains the trailing 30 daily log-returns. The CorrelationMatrixClient
 * combines this with computeCorrelationMatrix() to render the heatmap.
 *
 * The cointegration matrix (toggle on the page) is fetched separately from
 * /api/analysis/cointegration which uses price levels (not returns) — the two
 * are intentionally different (Engle-Granger requires I(1) inputs, Pearson
 * correlation is computed on I(0) returns).
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getKlines } from '@/lib/market/binance';
import { dailyReturns } from '@/lib/analysis/correlation';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const assets = await db.asset.findMany({
      where: { assetClass: 'crypto', isActive: true },
      select: { symbol: true },
    });
    const symbols = assets.map((a) => a.symbol);
    if (symbols.length < 2) {
      return NextResponse.json(
        { success: false, error: 'need ≥2 active crypto assets' },
        { status: 422 },
      );
    }

    // Fetch 31 daily klines → 30 returns.
    const limit = 31;
    const results = await Promise.all(
      symbols.map(async (sym) => {
        try {
          const klines = await getKlines(sym, '1d', limit);
          const closes = klines.map((k) => k.close);
          return { sym, returns: dailyReturns(closes) };
        } catch (e) {
          console.warn(`[correlation/returns] klines failed for ${sym}:`, (e as Error).message);
          return { sym, returns: [] as number[] };
        }
      }),
    );

    const out: Record<string, number[]> = {};
    for (const { sym, returns } of results) {
      if (returns.length >= 20) out[sym] = returns;
    }

    if (Object.keys(out).length < 2) {
      return NextResponse.json(
        { success: false, error: 'insufficient returns (need ≥2 symbols with ≥20 bars)' },
        { status: 422 },
      );
    }

    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
