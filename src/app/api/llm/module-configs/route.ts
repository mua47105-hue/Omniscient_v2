// CRUD for ModuleModelConfig — wires a (moduleKey, layer) pair to a provider+model.
// Used by the Settings → Providers → "Module → Model Mapping" section.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const configs = await db.moduleModelConfig.findMany({
      include: { model: { include: { provider: true } }, provider: true },
      orderBy: [{ moduleKey: 'asc' }, { layer: 'asc' }],
    });
    return NextResponse.json<ApiResult<typeof configs>>({ success: true, data: configs });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { moduleKey, layer, modelId, providerId, temperature, systemPrompt, enabled } = body;

    if (!moduleKey || !layer) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'moduleKey and layer are required' },
        { status: 400 },
      );
    }

    // Verify the model belongs to the provider (defensive — guards UI mistakes).
    if (modelId && providerId) {
      const model = await db.llmModel.findUnique({ where: { id: modelId } });
      if (!model || model.providerId !== providerId) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Model does not belong to the selected provider' },
          { status: 400 },
        );
      }
    }

    const tempVal =
      typeof temperature === 'number' && !Number.isNaN(temperature)
        ? Math.max(0, Math.min(2, temperature))
        : 0.3;

    // Upsert on the (moduleKey, layer) unique constraint.
    const existing = await db.moduleModelConfig.findFirst({
      where: { moduleKey, layer },
    });

    const data = {
      moduleKey,
      layer,
      modelId: modelId ?? existing?.modelId,
      providerId: providerId ?? existing?.providerId,
      temperature: tempVal,
      systemPrompt: systemPrompt ?? null,
      enabled: typeof enabled === 'boolean' ? enabled : true,
    };
    if (!data.modelId || !data.providerId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'modelId and providerId are required' },
        { status: 400 },
      );
    }

    let cfg;
    if (existing) {
      cfg = await db.moduleModelConfig.update({
        where: { id: existing.id },
        data,
        include: { model: { include: { provider: true } }, provider: true },
      });
    } else {
      cfg = await db.moduleModelConfig.create({
        data: { ...data },
        include: { model: { include: { provider: true } }, provider: true },
      });
    }
    return NextResponse.json<ApiResult<typeof cfg>>({ success: true, data: cfg });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'id required' },
        { status: 400 },
      );
    }
    await db.moduleModelConfig.delete({ where: { id } });
    return NextResponse.json<ApiResult<{ id: string }>>({ success: true, data: { id } });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
