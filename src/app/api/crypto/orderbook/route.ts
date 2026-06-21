/**
 * Crypto order book API.
 *
 * GET /api/crypto/orderbook?symbol=BTCUSDT&limit=50
 *
 * Thin proxy over binance.getOrderBook (5s cache).
 */
import { NextResponse } from 'next/server';
import { getOrderBook } from '@/lib/market/binance';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
    const limitRaw = searchParams.get('limit') ?? '50';
    const limit = Math.max(5, Math.min(1000, parseInt(limitRaw, 10) || 50));

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'missing symbol' },
        { status: 400 },
      );
    }

    const ob = await getOrderBook(symbol, limit);
    return NextResponse.json({ success: true, data: ob });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
