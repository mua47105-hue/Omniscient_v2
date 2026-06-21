/**
 * Fear & Greed Index API (alternative.me).
 *
 * GET /api/macro/fear-greed
 *
 * Returns the latest N entries (default 30) — newest first. 5-min cache.
 */
import { NextResponse } from 'next/server';
import { getFearGreed } from '@/lib/market/macro';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get('limit') ?? '30';
    const limit = Math.max(1, Math.min(365, parseInt(limitRaw, 10) || 30));

    const entries = await getFearGreed(limit);
    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
