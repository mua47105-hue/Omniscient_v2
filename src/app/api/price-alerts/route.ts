// Price Alerts CRUD API.
//   GET    /api/price-alerts?status=active|triggered|all  → list alerts (createdAt desc)
//   POST   /api/price-alerts                              → create new alert
//   DELETE /api/price-alerts?id=...                       → delete alert
//   PATCH  /api/price-alerts?id=...                       → update status (active/disabled) or other fields
// Schema-version-aware db singleton — see src/lib/db.ts.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isValidCondition } from '@/lib/analysis/price-alerts';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') || 'active';
    const where: any = {};
    if (status && status !== 'all') where.status = status;

    const alerts = await db.priceAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json<ApiResult<typeof alerts>>({
      success: true,
      data: alerts,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

interface CreateBody {
  assetSymbol?: string;
  condition?: string;
  targetPrice?: number;
  channel?: string;
  note?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateBody;
    const assetSymbol = (body.assetSymbol || '').trim().toUpperCase();
    const condition = (body.condition || '').trim();
    const targetPrice = Number(body.targetPrice);
    const channel = (body.channel || 'dashboard').trim();
    const note = body.note?.trim() || null;

    if (!assetSymbol) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'assetSymbol is required' },
        { status: 400 },
      );
    }
    if (!isValidCondition(condition)) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `condition must be one of: above, below, crosses_up, crosses_down`,
        },
        { status: 400 },
      );
    }
    if (!isFinite(targetPrice) || targetPrice <= 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'targetPrice must be a positive number' },
        { status: 400 },
      );
    }
    if (!['dashboard', 'telegram', 'both'].includes(channel)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'channel must be dashboard, telegram, or both' },
        { status: 400 },
      );
    }

    const created = await db.priceAlert.create({
      data: {
        assetSymbol,
        condition,
        targetPrice,
        channel,
        note,
        status: 'active',
      },
    });
    return NextResponse.json<ApiResult<typeof created>>(
      { success: true, data: created },
      { status: 201 },
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'id query param is required' },
        { status: 400 },
      );
    }
    await db.priceAlert.delete({ where: { id } });
    return NextResponse.json<ApiResult<{ id: string }>>({
      success: true,
      data: { id },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

interface PatchBody {
  status?: string;
  note?: string;
}

export async function PATCH(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'id query param is required' },
        { status: 400 },
      );
    }
    const body = (await req.json()) as PatchBody;
    const data: any = {};
    if (body.status) {
      if (!['active', 'triggered', 'disabled'].includes(body.status)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'status must be active, triggered, or disabled',
          },
          { status: 400 },
        );
      }
      data.status = body.status;
      // Re-enabling a triggered alert: clear the trigger timestamp so it can
      // fire again. Keep currentPrice so crosses_* logic continues to work.
      if (body.status === 'active') {
        data.triggeredAt = null;
      }
    }
    if (typeof body.note === 'string') data.note = body.note.trim() || null;

    const updated = await db.priceAlert.update({ where: { id }, data });
    return NextResponse.json<ApiResult<typeof updated>>({
      success: true,
      data: updated,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
