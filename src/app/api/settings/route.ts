import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getAllSettings } from '@/lib/config/settings';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// In-memory fallback for when the database is unavailable (e.g., Vercel without DATABASE_URL)
const memorySettings = new Map<string, string>();

export async function GET() {
  try {
    const settings = await getAllSettings();
    return NextResponse.json<ApiResult<typeof settings>>({ success: true, data: settings });
  } catch {
    // Database unavailable — return in-memory settings
    const out: Record<string, any> = {};
    for (const [k, v] of memorySettings) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    }
    return NextResponse.json<ApiResult<typeof out>>({ success: true, data: out });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
      const body = await req.json();
      if (body.key && 'value' in body) {
        memorySettings.set(body.key, JSON.stringify(body.value));
      } else {
        for (const [k, v] of Object.entries(body)) {
          memorySettings.set(k, JSON.stringify(v));
        }
      }
      return NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
    } catch (e: any) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
    }
  }
}
