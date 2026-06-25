// LLM provider/model test endpoint.
//
// Sends a trivial prompt ("Reply with: OK") to verify the provider+model+key
// combination works end-to-end. Returns the raw content + latency.
import { validateBody, schemas } from "@/lib/api/validation";
//
// IMPORTANT: This endpoint can test ANY provider, even inactive ones — so users
// can verify a key works BEFORE activating the provider. The complete() function
// in the router requires isActive:true, but the test endpoint bypasses that
// by looking up the provider directly and calling callProvider with the raw config.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sanitizeApiKey } from '@/lib/llm/router-helpers';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface TestResult {
  content: string;
  model: string;
  latencyMs: number;
}

export async function POST(req: NextRequest) {
  try {
    const { provider, model } = await validateBody(req, schemas.llmTest);
    if (!provider || typeof provider !== 'string') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'provider (string) is required' },
        { status: 400 }
      );
    }
    if (!model || typeof model !== 'string') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'model (string) is required' },
        { status: 400 }
      );
    }

    // Look up the provider DIRECTLY (bypasses the isActive check in getProviderConfig)
    // so users can test providers before activating them.
    const providerRow = await db.llmProvider.findFirst({
      where: { name: provider },
      include: { models: { where: { isActive: true } } },
    });

    if (!providerRow) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Provider "${provider}" not found in the database` },
        { status: 404 }
      );
    }

    // Find the requested model (or the first active model)
    const modelRow = model
      ? providerRow.models.find((m) => m.modelId === model)
      : providerRow.models[0];

    if (!modelRow) {
      const availableModels = providerRow.models.map((m) => m.modelId).join(', ') || 'none';
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Model "${model}" not found for ${provider}. Available: ${availableModels}` },
        { status: 404 }
      );
    }

    // Check if the API key is a placeholder
    const sanitizedKey = sanitizeApiKey(providerRow.apiKey);
    if (!sanitizedKey || sanitizedKey.startsWith('PASTE_') || sanitizedKey.startsWith('YOUR_')) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `No API key configured for ${provider}. Paste a real API key in Settings → Providers, or set the ${provider} env var as an HF Space Secret.`,
        },
        { status: 400 }
      );
    }

    // Dynamically import the router (to avoid circular deps) and call the provider
    const { callProvider } = await import('@/lib/llm/router');

    const result = await callProvider(
      { baseUrl: providerRow.baseUrl, apiKey: providerRow.apiKey, name: providerRow.name },
      modelRow.modelId,
      [{ role: 'user', content: 'Reply with exactly one word: OK' }],
      { temperature: 0, maxTokens: 10 }
    );

    const data: TestResult = {
      content: result.content,
      model: result.model,
      latencyMs: result.latencyMs,
    };
    return NextResponse.json<ApiResult<TestResult>>({ success: true, data });
  } catch (e: any) {
    let msg = e?.message || String(e);

    // Clear error messages for common failures
    if (msg.includes('Invalid character') && msg.includes('header')) {
      msg = 'API key contains invalid characters. Re-enter the key without quotes or extra whitespace.';
    }
    if (msg.includes('401')) {
      msg = 'Invalid API key (401). Check that the key is correct and not expired.';
    }
    if (msg.includes('403')) {
      msg = 'Access forbidden (403). The API key may not have permission for this model, or the IP is blocked.';
    }
    if (msg.includes('429')) {
      msg = 'Rate limited (429). Too many requests — wait a minute and try again.';
    }
    if (msg.includes('timeout')) {
      msg = 'Request timed out. The provider may be slow or unavailable.';
    }

    return NextResponse.json<ApiResult<never>>(
      { success: false, error: msg.slice(0, 300) },
      { status: 500 }
    );
  }
}
