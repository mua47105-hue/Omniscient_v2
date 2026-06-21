/**
 * Watchlists API.
 *
 * GET /api/watchlists
 *   Returns all Watchlist rows.
 *
 * POST /api/watchlists
 *   Create or update. Body:
 *     { id?, name, assetClass?, symbols?: string[], isActive? }
 *   - `symbols` is JSON-stringified on the server.
 *
 * DELETE /api/watchlists?id=xxx
 *   Delete a watchlist.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.watchlist.findMany({
      orderBy: { name: 'asc' },
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
  name: string;
  assetClass?: string;
  symbols?: string[];
  isActive?: boolean;
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

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { success: false, error: 'name required' },
        { status: 400 },
      );
    }

    const data = {
      name: body.name.trim(),
      assetClass: body.assetClass ?? null,
      symbols: JSON.stringify(body.symbols ?? []),
      isActive: body.isActive ?? true,
    };

    let row;
    if (body.id) {
      row = await db.watchlist.update({ where: { id: body.id }, data });
    } else {
      row = await db.watchlist.create({ data });
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
    await db.watchlist.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
