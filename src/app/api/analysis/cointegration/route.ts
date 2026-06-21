/**
 * E3 — Cointegration matrix API.
 *
 * GET /api/analysis/cointegration?symbols=BTCUSDT,ETHUSDT,SOLUSDT,...
 *
 * Fetches 1d klines (200 bars) for each symbol, builds a {symbol: close[]}
 * map, and calls computeCointegrationMatrix. Returns the matrix in the
 * standard {success, data} envelope.
 */
import { NextResponse } from 'next/server';
import { getKlines } from '@/lib/market/binance';
import { computeCointegrationMatrix } from '@/lib/analysis/cointegration';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get('symbols') ?? '';
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (symbols.length < 2) {
      return NextResponse.json(
        { success: false, error: 'provide ≥2 symbols via ?symbols=A,B,C' },
        { status: 400 },
      );
    }

    const limit = 200;
    const klinesBySymbol: Array<{ sym: string; closes: number[] }> = [];
    await Promise.all(
      symbols.map(async (sym) => {
        try {
          const klines = await getKlines(sym, '1d', limit);
          klinesBySymbol.push({ sym, closes: klines.map((k) => k.close) });
        } catch (e) {
          console.warn(`[cointegration] klines failed for ${sym}:`, (e as Error).message);
          klinesBySymbol.push({ sym, closes: [] });
        }
      }),
    );

    const prices: Record<string, number[]> = {};
    for (const { sym, closes } of klinesBySymbol) {
      if (closes.length >= 30) prices[sym] = closes;
    }

    if (Object.keys(prices).length < 2) {
      return NextResponse.json(
        { success: false, error: 'insufficient price history (need ≥2 symbols with ≥30 bars)' },
        { status: 422 },
      );
    }

    const matrix = computeCointegrationMatrix(prices, { lookback: limit });
    return NextResponse.json({ success: true, data: matrix });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
