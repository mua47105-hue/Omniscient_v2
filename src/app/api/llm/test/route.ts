// LLM provider/model test endpoint.
//
// WHY THIS EXISTS:
// The Settings → Providers page has a "Test" button on every provider + model
// card. The frontend (ProvidersManager.tsx) POSTs { provider, model } to this
// route and expects { content, model, latencyMs } back. Without this route,
// the request fell through to Next.js's HTML 404/lock page, the frontend's
// `r.json().catch(() => 'Invalid JSON')` fired, and the user saw
// "Test failed: Invalid JSON" — even though the provider itself was perfectly
// healthy.
//
// This endpoint sends a trivial prompt ("Reply with: OK") to verify the
// provider+model+key combination actually works end-to-end, then returns the
// raw content + latency so the UI can show "Model responded · 812ms · OK".

import { NextRequest, NextResponse } from 'next/server';
import { complete } from '@/lib/llm/router';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // LLM test should never take >30s

interface TestResult {
  content: string;
  model: string;
  latencyMs: number;
}

export async function POST(req: NextRequest) {
  try {
    const { provider, model } = await req.json();
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

    // Trivial prompt — we just want to confirm the round-trip works.
    // No json_mode (the test is about connectivity, not structured output).
    const result = await complete({
      provider,
      model,
      messages: [
        { role: 'user', content: 'Reply with exactly one word: OK' },
      ],
      temperature: 0,
      maxTokens: 10,
    });

    const data: TestResult = {
      content: result.content,
      model: result.model,
      latencyMs: result.latencyMs,
    };
    return NextResponse.json<ApiResult<TestResult>>({ success: true, data });
  } catch (e: any) {
    // Surface a clear, actionable error message
    let msg = e?.message || String(e);

    // If the error is about invalid header characters, explain what happened
    if (msg.includes('Invalid character') && msg.includes('header')) {
      msg = 'API key contains invalid characters (quotes, newlines, or control chars). Re-enter the key without quotes or extra whitespace.';
    }
    // If it's a "no API key" error, point the user to the right place
    if (msg.includes('No API key configured')) {
      msg += ' Paste a real API key in Settings → Providers, or set the env var as an HF Space Secret.';
    }

    return NextResponse.json<ApiResult<never>>(
      { success: false, error: msg.slice(0, 300) },
      { status: 500 }
    );
  }
}
