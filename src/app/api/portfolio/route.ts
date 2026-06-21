/**
 * Portfolio API — holdings tracker.
 *
 * GET /api/portfolio
 *   Returns all PortfolioHolding rows, newest first.
 *
 * POST /api/portfolio
 *   Create or update a holding. Body:
 *     { id?, assetSymbol, quantity, entryPrice, entryDate?, notes? }
 *   - If `id` provided → update existing row.
 *   - Else → create new row.
 *   - assetSymbol auto-uppercased; quantity/entryPrice coerced to float.
 *
 * DELETE /api/portfolio?id=xxx
 *   Delete a holding by id.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const holdings = await db.portfolioHolding.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: holdings });
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
  quantity: number;
  entryPrice: number;
  entryDate?: string;
  notes?: string;
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

    if (!body.assetSymbol || typeof body.assetSymbol !== 'string') {
      return NextResponse.json(
        { success: false, error: 'assetSymbol required' },
        { status: 400 },
      );
    }
    const quantity = Number(body.quantity);
    const entryPrice = Number(body.entryPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'quantity must be a positive number' },
        { status: 400 },
      );
    }
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      return NextResponse.json(
        { success: false, error: 'entryPrice must be a positive number' },
        { status: 400 },
      );
    }

    const data = {
      assetSymbol: body.assetSymbol.toUpperCase().trim(),
      quantity,
      entryPrice,
      ...(body.entryDate ? { entryDate: new Date(body.entryDate) } : {}),
      ...(body.notes != null ? { notes: body.notes } : {}),
    };

    let row;
    if (body.id) {
      row = await db.portfolioHolding.update({
        where: { id: body.id },
        data,
      });
    } else {
      row = await db.portfolioHolding.create({ data });
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
    await db.portfolioHolding.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
