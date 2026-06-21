/**
 * Price alerts check API.
 *
 * POST /api/price-alerts/check
 *   Triggers an immediate scan of all active PriceAlert rows. Returns the
 *   PriceAlertSummary from lib/analysis/price-alerts.
 */
import { NextResponse } from 'next/server';
import { checkPriceAlerts } from '@/lib/analysis/price-alerts';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const summary = await checkPriceAlerts();
    return NextResponse.json({ success: true, data: summary });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
