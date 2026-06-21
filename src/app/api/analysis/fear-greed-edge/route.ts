/**
 * E8 — Asymmetric Fear & Greed edge API.
 *
 * GET /api/analysis/fear-greed-edge
 *
 * Calls computeFearGreedSignal — reuses getFearGreed(180) upstream cache.
 * Returns the asymmetric edge (MOMENTUM_LONG / MEAN_REVERT_LONG /
 * MEAN_REVERT_SHORT / NONE) plus the streak + regime + conviction.
 */
import { NextResponse } from 'next/server';
import { computeFearGreedSignal } from '@/lib/analysis/fear-greed-edge';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const signal = await computeFearGreedSignal();
    return NextResponse.json({ success: true, data: signal });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
