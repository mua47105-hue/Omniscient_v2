/**
 * Module model configs API.
 *
 * GET /api/llm/module-configs
 *   Returns all ModuleModelConfig rows (with provider + model relations).
 *
 * POST /api/llm/module-configs
 *   Upsert by (moduleKey, layer) — the @@unique pair.
 *   Body:
 *     { moduleKey, layer, modelId, providerId, temperature?, systemPrompt?, enabled? }
 *
 * DELETE /api/llm/module-configs?id=xxx
 *   Delete a config.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.moduleModelConfig.findMany({
      include: { provider: true, model: true },
      orderBy: [{ moduleKey: 'asc' }, { layer: 'asc' }],
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
  moduleKey: string;
  layer: string;
  modelId: string;
  providerId: string;
  temperature?: number;
  systemPrompt?: string;
  enabled?: boolean;
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

    if (!body.moduleKey || !body.layer || !body.modelId || !body.providerId) {
      return NextResponse.json(
        { success: false, error: 'moduleKey, layer, modelId, providerId all required' },
        { status: 400 },
      );
    }

    const row = await db.moduleModelConfig.upsert({
      where: {
        moduleKey_layer: {
          moduleKey: body.moduleKey,
          layer: body.layer,
        },
      },
      create: {
        moduleKey: body.moduleKey,
        layer: body.layer,
        modelId: body.modelId,
        providerId: body.providerId,
        temperature: body.temperature ?? 0.3,
        systemPrompt: body.systemPrompt ?? null,
        enabled: body.enabled ?? true,
      },
      update: {
        modelId: body.modelId,
        providerId: body.providerId,
        temperature: body.temperature ?? 0.3,
        systemPrompt: body.systemPrompt ?? null,
        enabled: body.enabled ?? true,
      },
      include: { provider: true, model: true },
    });
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
    await db.moduleModelConfig.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
