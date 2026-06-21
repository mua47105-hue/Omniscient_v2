// Price Alerts check endpoint — runs the shared `checkPriceAlerts()` engine
// and returns a summary. Called manually (the "Check Now" button on the page)
// and by the scheduler tick (best-effort, before crypto scans).

import { NextResponse } from 'next/server';
import { checkPriceAlerts } from '@/lib/analysis/price-alerts';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  try {
    const summary = await checkPriceAlerts();
    return NextResponse.json<ApiResult<typeof summary>>({
      success: true,
      data: summary,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const summary = await checkPriceAlerts();
    return NextResponse.json<ApiResult<typeof summary>>({
      success: true,
      data: summary,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
