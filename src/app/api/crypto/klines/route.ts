/**
 * Crypto klines API.
 *
 * GET /api/crypto/klines?symbol=BTCUSDT&interval=4h&limit=200
 *
 * Thin proxy over binance.getKlines (which has a 30s cache). Validates the
 * symbol is uppercase + rejects bogus intervals.
 */
import { NextResponse } from 'next/server';
import { getKlines } from '@/lib/market/binance';

export const dynamic = 'force-dynamic';

const ALLOWED_INTERVALS = new Set([
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '3d', '1w', '1M',
]);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
    const interval = (searchParams.get('interval') ?? '4h').trim();
    const limitRaw = searchParams.get('limit') ?? '200';
    const limit = Math.max(1, Math.min(1500, parseInt(limitRaw, 10) || 200));

    if (!symbol) {
      return NextResponse.json(
        { success: false, error: 'missing symbol' },
        { status: 400 },
      );
    }
    if (!ALLOWED_INTERVALS.has(interval)) {
      return NextResponse.json(
        { success: false, error: `unsupported interval: ${interval}` },
        { status: 400 },
      );
    }

    const klines = await getKlines(symbol, interval, limit);
    return NextResponse.json({ success: true, data: klines });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
