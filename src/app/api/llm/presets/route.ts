// Provider presets endpoint — returns the catalog of pre-configured LLM
// providers so the UI can show a "Quick Add" grid. Users click a preset,
// the provider + models are created with a placeholder key, and the user
// just pastes their API key.
import { validateBody, schemas } from "@/lib/api/validation";
import { NextResponse, NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { PROVIDER_PRESETS } from '@/lib/llm/presets';
import { redactProvider, safeError } from '@/lib/security/redact';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET — return the full preset catalog (for the UI's "Quick Add" grid)
export async function GET() {
  return NextResponse.json<ApiResult<typeof PROVIDER_PRESETS>>({
    success: true,
    data: PROVIDER_PRESETS,
  });
}

// POST — add a provider from a preset by name
// Body: { name: string, apiKey?: string }
// If apiKey is provided, uses it. Otherwise uses the placeholder.
export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req, schemas.llmPresets);
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const { name, apiKey } = body;
    if (!name || typeof name !== 'string') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Provider name required' }, { status: 400 });
    }

    const preset = PROVIDER_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!preset) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: `Unknown provider preset: ${name}` }, { status: 404 });
    }

    // Check if provider already exists
    const existing = await db.llmProvider.findUnique({ where: { name: preset.name } });
    if (existing) {
      // If apiKey provided, update it; otherwise just return the existing provider
      if (apiKey && typeof apiKey === 'string' && !apiKey.startsWith('PASTE_')) {
        const updated = await db.llmProvider.update({
          where: { id: existing.id },
          data: { apiKey, isActive: true },
          include: { models: true },
        });
        return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: redactProvider(updated) });
      }
      return NextResponse.json<ApiResult<never>>({
        success: false,
        error: `${preset.name} already exists. Edit it to change the API key.`,
      }, { status: 409 });
    }

    // Create the provider + all its preset models
    const created = await db.llmProvider.create({
      data: {
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: apiKey && typeof apiKey === 'string' && !apiKey.startsWith('PASTE_') ? apiKey : preset.apiKeyPlaceholder,
        isActive: true,
        notes: preset.notes,
        models: {
          create: preset.models.map((m) => ({
            modelId: m.modelId,
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            freeTierRpm: m.freeTierRpm,
            isActive: true,
            capabilities: '["text","json"]',
          })),
        },
      },
      include: { models: true },
    });

    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: redactProvider(created) });
  } catch (e) {
    const { status, error } = safeError(e, 'presets POST');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}
