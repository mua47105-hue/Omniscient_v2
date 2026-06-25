import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { redactProvider, safeError } from '@/lib/security/redact';
import type { ApiResult } from '@/lib/types';
import { validateBody, schemas } from "@/lib/api/validation";

export const dynamic = 'force-dynamic';

// Known LLM provider base URLs — used to validate POST input (prevents SSRF
// via arbitrary baseUrl, per Improvement Plan §2.5)
const ALLOWED_BASEURL_PATTERNS = [
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'groq.com',
  'integrate.api.nvidia.com',
  'api.mistral.ai',
  'api.cerebras.ai',
  'api.aimlapi.com',
  'api.siliconflow.cn',
  'api.x.ai',
  'api-inference.huggingface.co',
  'text.pollinations.ai',
  'api.together.xyz',
  'api.deepseek.com',
];

function isValidBaseUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  return ALLOWED_BASEURL_PATTERNS.some((p) => url.includes(p));
}

export async function GET() {
  try {
    const providers = await db.llmProvider.findMany({
      include: { models: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    // Redact apiKey in every provider + nested model before sending to client
    const redacted = providers.map(redactProvider);
    return NextResponse.json<ApiResult<typeof redacted>>({ success: true, data: redacted });
  } catch (e) {
    const { status, error } = safeError(e, 'providers GET');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req, schemas.llmProviders);
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const { id, name, baseUrl, apiKey, notes, isActive } = body;

    // Validate baseUrl against allowlist (SSRF prevention)
    if (baseUrl && !isValidBaseUrl(baseUrl)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'baseUrl must match a known LLM provider domain' },
        { status: 400 }
      );
    }

    if (id) {
      const updated = await db.llmProvider.update({
        where: { id },
        data: { name, baseUrl, apiKey, notes, isActive },
      });
      return NextResponse.json<ApiResult<typeof updated>>({ success: true, data: redactProvider(updated) });
    }
    const created = await db.llmProvider.create({
      data: { name, baseUrl, apiKey, notes, isActive: isActive ?? false },
    });
    return NextResponse.json<ApiResult<typeof created>>({ success: true, data: redactProvider(created) });
  } catch (e) {
    const { status, error } = safeError(e, 'providers POST');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json<ApiResult<never>>({ success: false, error: 'id required' }, { status: 400 });
    await db.llmProvider.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    const { status, error } = safeError(e, 'providers DELETE');
    return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
  }
}
