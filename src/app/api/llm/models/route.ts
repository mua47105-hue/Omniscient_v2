/**
 * LLM Models API.
 *
 * GET /api/llm/models?providerId=xxx
 *   Returns all LlmModel rows (optionally filtered by providerId).
 *
 * POST /api/llm/models
 *   Create or update a model. Body:
 *     { id?, providerId, modelId, displayName, contextWindow?, freeTierRpm?,
 *       isActive?, capabilities? }
 *
 * DELETE /api/llm/models?id=xxx
 *   Delete a model. Cascades to module configs.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const providerId = searchParams.get('providerId');
    const rows = await db.llmModel.findMany({
      where: providerId ? { providerId } : undefined,
      include: { provider: true },
      orderBy: [{ providerId: 'asc' }, { modelId: 'asc' }],
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
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow?: number;
  freeTierRpm?: number;
  isActive?: boolean;
  capabilities?: string;
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

    if (!body.providerId || !body.modelId || !body.displayName) {
      return NextResponse.json(
        { success: false, error: 'providerId, modelId, displayName all required' },
        { status: 400 },
      );
    }

    const data = {
      providerId: body.providerId,
      modelId: body.modelId.trim(),
      displayName: body.displayName.trim(),
      contextWindow: body.contextWindow ?? 128000,
      freeTierRpm: body.freeTierRpm ?? 10,
      isActive: body.isActive ?? true,
      capabilities: body.capabilities ?? 'text',
    };

    let row;
    if (body.id) {
      row = await db.llmModel.update({
        where: { id: body.id },
        data,
        include: { provider: true },
      });
    } else {
      row = await db.llmModel.create({
        data,
        include: { provider: true },
      });
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
    await db.llmModel.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
