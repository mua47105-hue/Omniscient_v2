import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = await db.llmProvider.findMany({
    include: { models: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return NextResponse.json<ApiResult<typeof providers>>({ success: true, data: providers });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, baseUrl, apiKey, notes, isActive } = body;
    if (id) {
      const updated = await db.llmProvider.update({
        where: { id },
        data: { name, baseUrl, apiKey, notes, isActive },
      });
      return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: updated });
    }
    const created = await db.llmProvider.create({
      data: { name, baseUrl, apiKey, notes, isActive: isActive ?? false },
    });
    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: created });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
  await db.llmProvider.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
