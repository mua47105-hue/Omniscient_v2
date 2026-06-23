// Bootstrap sync — pulls settings from Supabase into local SQLite on startup.
//
// WHY THIS EXISTS:
// On Hugging Face Spaces, the container filesystem is EPHEMERAL — every
// restart/rebuild wipes /app and re-seeds the SQLite DB from scratch. This
// means all user-configured settings (LLM API keys, watchlists, alert
// thresholds, module configs) are lost unless they're stored somewhere
// persistent.
//
// The persistence stack (in priority order):
//   1. HF Space Secrets (env vars) — for credentials. Handled by getSetting()
//      env-over-DB resolution. No sync needed.
//   2. Supabase Setting table — for ALL settings. On startup, we pull every
//      row from Supabase and upsert it into local SQLite. This restores the
//      full app state (watchlists, module configs, alert thresholds, etc.).
//   3. Local SQLite on /data (HF Storage Bucket) — persists across restarts
//      when the DB lives on the mounted volume.
//
// This module handles layer 2: it runs once on startup (via instrumentation.ts)
// and pulls all settings from Supabase into the local DB. It's idempotent —
// running it multiple times is safe (uses upsert).
//
// IMPORTANT: This only pulls the Setting table. LlmProvider, LlmModel,
// ModuleModelConfig, Watchlist, and Asset records are NOT synced here because
// they have relational integrity constraints. Those should be synced via the
// /api/supabase/sync endpoint (which handles all 16 tables). This bootstrap
// only handles the lightweight Setting KV pairs that the app needs to
// function before the full sync runs.

import { getSupabaseClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';

let bootstrapRan = false;
let bootstrapResult: { ok: boolean; synced: number; error?: string } | null = null;

/**
 * Pull all settings from Supabase and upsert them into local SQLite.
 * Safe to call multiple times — only runs once per process (guarded by
 * bootstrapRan flag). Called from instrumentation.ts on app startup.
 *
 * Returns { ok, synced, error? } so callers can log the result.
 */
export async function bootstrapSettingsFromSupabase(): Promise<{ ok: boolean; synced: number; error?: string }> {
  if (bootstrapRan) return bootstrapResult ?? { ok: false, synced: 0, error: 'no result' };
  bootstrapRan = true;

  try {
    const client = await getSupabaseClient();
    if (!client) {
      // Supabase not configured — this is fine, just skip.
      bootstrapResult = { ok: true, synced: 0, error: 'Supabase not configured' };
      return bootstrapResult;
    }

    // Pull all settings from the Supabase Setting table
    const { data, error } = await client.from('Setting').select('key,value');

    if (error) {
      // If the table doesn't exist yet, that's OK — the user just needs to
      // run the schema SQL. Don't crash on this.
      if (error.message.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
        bootstrapResult = { ok: true, synced: 0, error: 'Setting table does not exist in Supabase yet — run the schema SQL' };
        return bootstrapResult;
      }
      bootstrapResult = { ok: false, synced: 0, error: error.message };
      return bootstrapResult;
    }

    if (!data || data.length === 0) {
      bootstrapResult = { ok: true, synced: 0, error: 'No settings in Supabase yet' };
      return bootstrapResult;
    }

    // Upsert each setting into local SQLite
    let synced = 0;
    for (const row of data) {
      if (!row.key) continue;
      try {
        await db.setting.upsert({
          where: { key: row.key },
          create: { key: row.key, value: row.value ?? '' },
          update: { value: row.value ?? '' },
        });
        synced++;
      } catch (e: any) {
        console.error(`[bootstrap] Failed to sync setting '${row.key}':`, e.message);
      }
    }

    console.log(`[bootstrap] Synced ${synced} settings from Supabase to local SQLite`);
    bootstrapResult = { ok: true, synced };
    return bootstrapResult;
  } catch (e: any) {
    console.error('[bootstrap] Supabase sync failed:', e.message);
    bootstrapResult = { ok: false, synced: 0, error: e.message };
    return bootstrapResult;
  }
}

/**
 * Push all local SQLite settings to Supabase. Called when the user saves a
 * setting locally and wants it synced to the cloud. Also safe to call
 * multiple times (uses upsert).
 */
export async function pushSettingsToSupabase(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  try {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, pushed: 0, error: 'Supabase not configured' };
    }

    const rows = await db.setting.findMany();
    let pushed = 0;
    for (const row of rows) {
      try {
        await client.from('Setting').upsert({
          key: row.key,
          value: row.value,
        }, { onConflict: 'key' });
        pushed++;
      } catch (e: any) {
        console.error(`[sync] Failed to push setting '${row.key}':`, e.message);
      }
    }

    return { ok: true, pushed };
  } catch (e: any) {
    return { ok: false, pushed: 0, error: e.message };
  }
}
