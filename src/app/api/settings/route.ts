import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getAllSettings, hasEnvOverride } from '@/lib/config/settings';
import { pushSettingsToSupabase } from '@/lib/sync/bootstrap';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// In-memory fallback for when the database is unavailable (e.g., Vercel without DATABASE_URL)
const memorySettings = new Map<string, string>();

export async function GET() {
  try {
    const settings = await getAllSettings();
    // Annotate which settings have HF Secret env-var overrides (so the UI can
    // show "managed by HF Secret" badges and disable editing).
    const overrides: Record<string, boolean> = {};
    for (const key of Object.keys(settings)) {
      overrides[key] = hasEnvOverride(key);
    }
    return NextResponse.json<ApiResult<typeof settings & { _envOverrides?: typeof overrides }>>({
      success: true,
      data: { ...settings, _envOverrides: overrides },
    });
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
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<ApiResult<never>>({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    // Collect the keys being saved so we can skip env-overridden ones and
    // sync the rest to Supabase.
    const keysToSave: [string, any][] = [];
    if (body.key && 'value' in body) {
      keysToSave.push([body.key, body.value]);
    } else {
      for (const [k, v] of Object.entries(body)) {
        keysToSave.push([k, v]);
      }
    }

    // Save each key to the DB, UNLESS it has an env-var override (HF Secret).
    // Env-overridden keys can't be changed from the UI — they're managed in
    // HF Space Settings.
    const skipped: string[] = [];
    for (const [k, v] of keysToSave) {
      if (hasEnvOverride(k)) {
        skipped.push(k);
        continue;
      }
      await setSetting(k, v);
    }

    // Push the saved settings to Supabase (cloud backup) — non-blocking, fail-safe
    pushSettingsToSupabase().catch((e) => {
      console.error('[settings] Supabase push failed (non-fatal):', e.message);
    });

    const msg = skipped.length > 0
      ? `Saved. Skipped ${skipped.length} env-overridden key(s): ${skipped.join(', ')}`
      : undefined;

    return NextResponse.json<ApiResult<{ ok: boolean; skipped?: string[] }>>({
      success: true,
      data: { ok: true, skipped: skipped.length > 0 ? skipped : undefined },
    });
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
    } catch (e: any) {
      return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
    }
  }
}
