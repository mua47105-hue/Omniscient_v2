// Supabase client — created on the fly from credentials stored in the Setting table
// OR from HF Space Secrets (env vars).
//
// Credential resolution (env-over-DB):
//   1. HF Secret: process.env.SUPABASE_URL + process.env.SUPABASE_ANON_KEY
//      (set in Space Settings UI, persists across restarts)
//   2. SQLite Setting table (set via Settings UI, persists if DB on /data)
//
// The user configures their Supabase Project URL + anon key via the dashboard
// (Settings → Supabase) OR via HF Space Secrets. This module reads both and
// returns a cached client instance. When credentials are not configured, returns null.
//
// IMPORTANT: the anon key is the PUBLIC key from Supabase. For a personal
// dashboard you should either disable RLS on the tables OR create policies
// that allow the anon role to read/write. The generated SQL schema (see
// schema-sql.ts) disables RLS by default for simplicity.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSetting } from '@/lib/config/settings';
import { HF_SECRETS } from '@/lib/runtime';

export const SUPABASE_SETTING_KEYS = {
  url: 'supabase_url',
  anonKey: 'supabase_anon_key',
} as const;

let cachedClient: SupabaseClient | null = null;
let cachedKey = ''; // URL + anonKey concatenation, for cache invalidation

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Read Supabase credentials — HF Secret env var first, then DB. Returns null if not configured. */
export async function getSupabaseConfig(): Promise<SupabaseConfig | null> {
  // Layer 1: HF Secret env vars (highest priority — persists across restarts)
  if (HF_SECRETS.supabaseUrl && HF_SECRETS.supabaseAnonKey &&
      !HF_SECRETS.supabaseUrl.startsWith('PASTE_') && !HF_SECRETS.supabaseAnonKey.startsWith('PASTE_')) {
    return { url: HF_SECRETS.supabaseUrl, anonKey: HF_SECRETS.supabaseAnonKey };
  }

  // Layer 2: SQLite Setting table
  const url = await getSetting<string>(SUPABASE_SETTING_KEYS.url, '');
  const anonKey = await getSetting<string>(SUPABASE_SETTING_KEYS.anonKey, '');
  if (!url || !anonKey || url.startsWith('PASTE_') || anonKey.startsWith('PASTE_')) {
    return null;
  }
  return { url, anonKey };
}

/**
 * Get a cached Supabase client. Creates one if credentials are configured and
 * the cache is stale. Returns null if credentials are not set.
 */
export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  const config = await getSupabaseConfig();
  if (!config) {
    cachedClient = null;
    cachedKey = '';
    return null;
  }
  const key = `${config.url}::${config.anonKey}`;
  if (cachedClient && key === cachedKey) {
    return cachedClient;
  }
  cachedClient = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedKey = key;
  return cachedClient;
}

/**
 * Test the Supabase connection by running a simple query against the `Setting`
 * table. Returns { ok, error?, tableExists? }.
 */
export async function testSupabaseConnection(
  url?: string,
  anonKey?: string
): Promise<{ ok: boolean; error?: string; tableExists?: boolean }> {
  let client: SupabaseClient | null;
  if (url && anonKey) {
    // Test with provided credentials (before saving)
    client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    client = await getSupabaseClient();
  }
  if (!client) {
    return { ok: false, error: 'Supabase credentials not configured.' };
  }
  try {
    // Try a simple select against the Setting table (created by the schema SQL).
    const { error } = await client.from('Setting').select('key').limit(1);
    if (error) {
      // If the table doesn't exist yet, the connection still works — return that info.
      if (
        error.message.includes('does not exist') ||
        error.message.includes('Could not find the table') ||
        error.code === '42P01' ||
        error.code === 'PGRST205'
      ) {
        return { ok: true, tableExists: false, error: 'Connection OK, but the Setting table does not exist yet. Run the SQL schema below.' };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, tableExists: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Unknown connection error' };
  }
}
