import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

import { validateBody, schemas } from "@/lib/api/validation";
export const dynamic = 'force-dynamic';

export async function GET() {
  const watchlists = await db.watchlist.findMany({ orderBy: { createdAt: 'asc' } });
  return NextResponse.json<ApiResult<typeof watchlists>>({ success: true, data: watchlists });
}

export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req, schemas.watchlists);
    const { id, name, assetClass, symbols, isActive } = body;
    if (id) {
      const updated = await db.watchlist.update({
        where: { id },
        data: { name, assetClass, symbols: JSON.stringify(symbols ?? []), isActive },
      });
      return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: updated });
    }
    const created = await db.watchlist.create({
      data: { name, assetClass, symbols: JSON.stringify(symbols ?? []), isActive: isActive ?? true },
    });
    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: created });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
  await db.watchlist.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
