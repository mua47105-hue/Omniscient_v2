import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');
  const status = req.nextUrl.searchParams.get('status'); // open | closed | all
  const where: any = {};
  if (status && status !== 'all') where.status = status;
  const signals = await db.signal.findMany({
    where,
    include: { asset: true, outcomes: true },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
  return NextResponse.json<ApiResult<typeof signals>>({ success: true, data: signals });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const signal = await db.signal.create({
      data: {
        assetId: body.assetId,
        direction: body.direction,
        conviction: body.conviction,
        timeframe: body.timeframe ?? '4h',
        layersSummary: JSON.stringify(body.layersSummary ?? {}),
        modelsUsed: JSON.stringify(body.modelsUsed ?? []),
        entryPrice: body.entryPrice,
        stopLoss: body.stopLoss,
        takeProfit: body.takeProfit,
        rationale: body.rationale ?? '',
        status: body.status ?? 'open',
        expiresAt: body.expiresAt,
      },
    });
    return NextResponse.json<ApiResult<typeof signal>>({ success: true, data: signal });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
