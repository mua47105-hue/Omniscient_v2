/**
 * Dev activity API (GitHub commit counts).
 *
 * GET /api/devactivity
 *
 * Returns the 7-day + prior-7-day commit counts + week-over-week delta for
 * the 5 canonical repos (bitcoin, go-ethereum, solana, chainlink, cardano-node).
 * 30-min cache; degrades gracefully per-repo on rate limit.
 */
import { NextResponse } from 'next/server';
import { getDevActivity } from '@/lib/market/devactivity';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await getDevActivity();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
