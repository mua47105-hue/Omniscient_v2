import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { redactModel, safeError } from '@/lib/security/redact';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const models = await db.llmModel.findMany({ include: { provider: true }, orderBy: { createdAt: 'asc' } });
    // Redact any apiKey field on the model + the nested provider (per §2.1)
    const redacted = models.map((m) => ({
      ...redactModel(m),
      provider: m.provider ? { ...m.provider, apiKey: undefined } : undefined,
    }));
    return NextResponse.json<ApiResult<typeof redacted>>({ success: true, data: redacted });
  } catch (e) {
    const { status, error } = safeError(e, 'models GET');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const { id, providerId, modelId, displayName, contextWindow, freeTierRpm, isActive } = body;
    if (id) {
      const updated = await db.llmModel.update({
        where: { id },
        data: { modelId, displayName, contextWindow, freeTierRpm, isActive },
      });
      return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: redactModel(updated) });
    }
    const created = await db.llmModel.create({
      data: { providerId, modelId, displayName, contextWindow, freeTierRpm, isActive: isActive ?? true },
    });
    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: redactModel(created) });
  } catch (e) {
    const { status, error } = safeError(e, 'models POST');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json<ApiResult<never>>({ success: false, error: 'id required' }, { status: 400 });
    await db.llmModel.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    const { status, error } = safeError(e, 'models DELETE');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}
