import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const models = await db.llmModel.findMany({ include: { provider: true }, orderBy: { createdAt: 'asc' } });
  return NextResponse.json<ApiResult<typeof models>>({ success: true, data: models });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, providerId, modelId, displayName, contextWindow, freeTierRpm, isActive } = body;
    if (id) {
      const updated = await db.llmModel.update({
        where: { id },
        data: { modelId, displayName, contextWindow, freeTierRpm, isActive },
      });
      return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: updated });
    }
    const created = await db.llmModel.create({
      data: { providerId, modelId, displayName, contextWindow, freeTierRpm, isActive: isActive ?? true },
    });
    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: created });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
  await db.llmModel.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
