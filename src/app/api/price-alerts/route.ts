/**
 * Price alerts API.
 *
 * GET /api/price-alerts?status=active|triggered|all
 *   Returns PriceAlert rows, newest first.
 *
 * POST /api/price-alerts
 *   Create or update. Body:
 *     { id?, assetSymbol, condition, targetPrice, channel?, note? }
 *   - condition: 'above' | 'below' | 'crosses_up' | 'crosses_down'
 *   - On update, status is preserved unless explicitly provided.
 *
 * DELETE /api/price-alerts?id=xxx
 *   Delete an alert.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const VALID_CONDITIONS = new Set(['above', 'below', 'crosses_up', 'crosses_down']);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const rows = await db.priceAlert.findMany({
      where: status && ['active', 'triggered'].includes(status) ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

interface UpsertBody {
  id?: string;
  assetSymbol: string;
  condition: string;
  targetPrice: number;
  channel?: string;
  note?: string;
  status?: string;
}

export async function POST(req: Request) {
  try {
    let body: UpsertBody;
    try {
      body = (await req.json()) as UpsertBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    if (!body.assetSymbol || !VALID_CONDITIONS.has(body.condition)) {
      return NextResponse.json(
        {
          success: false,
          error: `condition must be one of: ${Array.from(VALID_CONDITIONS).join(', ')}`,
        },
        { status: 400 },
      );
    }
    const target = Number(body.targetPrice);
    if (!Number.isFinite(target) || target <= 0) {
      return NextResponse.json(
        { success: false, error: 'targetPrice must be a positive number' },
        { status: 400 },
      );
    }

    const data = {
      assetSymbol: body.assetSymbol.toUpperCase().trim(),
      condition: body.condition,
      targetPrice: target,
      channel: body.channel ?? 'dashboard',
      note: body.note ?? null,
      ...(body.status ? { status: body.status } : {}),
    };

    let row;
    if (body.id) {
      row = await db.priceAlert.update({ where: { id: body.id }, data });
    } else {
      row = await db.priceAlert.create({ data });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id query param required' },
        { status: 400 },
      );
    }
    await db.priceAlert.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
