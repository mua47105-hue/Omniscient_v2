import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getAllSettings } from '@/lib/config/settings';
import { redactSettings, safeError } from '@/lib/security/redact';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// In-memory fallback for when the database is unavailable
const memorySettings = new Map<string, string>();

export async function GET() {
  try {
    const settings = await getAllSettings();
    // Redact all sensitive settings before returning (per §2.1)
    const redacted = redactSettings(settings);
    return NextResponse.json<ApiResult<typeof redacted>>({ success: true, data: redacted });
  } catch {
    const out: Record<string, any> = {};
    for (const [k, v] of memorySettings) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    }
    return NextResponse.json<ApiResult<typeof out>>({ success: true, data: redactSettings(out) });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
  } catch {
    return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    if (body.key && 'value' in body) {
      await setSetting(body.key, body.value);
    } else {
      for (const [k, v] of Object.entries(body)) {
        await setSetting(k, v);
      }
    }
    return NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
  } catch {
    // Database unavailable — save to in-memory fallback
    try {
      if (body.key && 'value' in body) {
        memorySettings.set(body.key, JSON.stringify(body.value));
      } else {
        for (const [k, v] of Object.entries(body)) {
          memorySettings.set(k, JSON.stringify(v));
        }
      }
      return NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
    } catch (e) {
      const { status, error } = safeError(e, 'settings POST');
      return NextResponse.json<ApiResult<never>>({ success: false, error }, { status });
    }
  }
}
