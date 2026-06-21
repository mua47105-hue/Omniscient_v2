/**
 * E4 — Derivatives-v2 API (basis + 25Δ skew + VRP + DVOL + regime).
 *
 * GET /api/analysis/derivatives-v2?currency=BTC
 *
 * Fetches 1d klines (30 bars) for the currency, then calls
 * computeDerivativesV2 which hits Deribit public options/book-summary and
 * Binance COIN-M quarterly futures. Result is cached 8h inside the module
 * (slow-moving signal). Returns CAPITULATION | NEUTRAL | EUPHORIA regime.
 */
import { NextResponse } from 'next/server';
import { getKlines } from '@/lib/market/binance';
import {
  computeDerivativesV2,
  type DerivativesCurrency,
} from '@/lib/market/deribit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cur = (searchParams.get('currency') ?? 'BTC').toUpperCase();
    if (cur !== 'BTC' && cur !== 'ETH') {
      return NextResponse.json(
        { success: false, error: 'currency must be BTC or ETH' },
        { status: 400 },
      );
    }

    // Deribit spot index is {currency}_usd — for klines we need a Binance pair.
    // BTC → BTCUSDT, ETH → ETHUSDT (the only two liquid perp pairs).
    const binanceSymbol = `${cur}USDT`;
    let klines30d = [];
    try {
      klines30d = await getKlines(binanceSymbol, '1d', 30);
    } catch (e) {
      console.warn(`[derivatives-v2] klines failed for ${binanceSymbol}:`, (e as Error).message);
    }

    const result = await computeDerivativesV2(cur as DerivativesCurrency, klines30d);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
