/**
 * LLM Providers API.
 *
 * GET /api/llm/providers
 *   Returns all LlmProvider rows, with models included.
 *
 * POST /api/llm/providers
 *   Create or update a provider. Body:
 *     { id?, name, baseUrl, apiKey, isActive?, notes? }
 *   - If `id` provided → update existing row.
 *   - Else → create new row.
 *   - `apiKey` is stored verbatim (may contain newline-separated keys for
 *     rotation; see lib/llm/router.ts).
 *
 * DELETE /api/llm/providers?id=xxx
 *   Delete a provider. Cascades to models + module configs.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const providers = await db.llmProvider.findMany({
      include: { models: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json({ success: true, data: providers });
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
  baseUrl: string;
  apiKey: string;
  isActive?: boolean;
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

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { success: false, error: 'name required' },
        { status: 400 },
      );
    }
    if (!body.baseUrl || typeof body.baseUrl !== 'string') {
      return NextResponse.json(
        { success: false, error: 'baseUrl required' },
        { status: 400 },
      );
    }

    const data = {
      name: body.name.trim(),
      baseUrl: body.baseUrl.trim(),
      apiKey: body.apiKey ?? '',
      isActive: body.isActive ?? true,
      notes: body.notes ?? null,
    };

    let row;
    if (body.id) {
      row = await db.llmProvider.update({
        where: { id: body.id },
        data,
        include: { models: true },
      });
    } else {
      row = await db.llmProvider.create({
        data,
        include: { models: true },
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
    await db.llmProvider.delete({ where: { id } });
    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
