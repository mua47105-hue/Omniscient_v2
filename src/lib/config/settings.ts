// Settings manager — typed wrapper around the Setting KV table.
//
// PERSISTENCE ARCHITECTURE (4-layer, env-over-DB):
//
//   Layer 1: HF Space Secrets (env vars) — PERSIST across restarts/rebuilds.
//            Set in Space Settings UI. This is where real API keys + Supabase
//            creds go. process.env.* is the highest-priority source.
//   Layer 2: Supabase cloud sync — on startup, pull the Setting table from
//            Supabase and merge into local SQLite (see lib/sync/bootstrap.ts).
//   Layer 3: Local SQLite (Setting table) — the editable fallback, survives
//            restarts when the DB lives on a persistent volume (/data on HF).
//   Layer 4: Hardcoded defaults — last resort.
//
// getSetting() checks env first, then DB, then returns the fallback.
// setSetting() always writes to the DB (env vars can't be set at runtime
// from inside the app — they're managed in the HF Space Settings UI).

import { db } from '@/lib/db';
import { HF_SECRETS } from '@/lib/runtime';

/**
 * Map a Setting key to its corresponding HF Secret env var.
 * Returns undefined if this key has no env-var equivalent.
 */
function envOverrideForKey(key: string): string | undefined {
  const map: Record<string, string | undefined> = {
    [SETTING_KEYS.appPassword]: HF_SECRETS.appPassword,
    [SETTING_KEYS.supabaseUrl]: HF_SECRETS.supabaseUrl,
    [SETTING_KEYS.supabaseAnonKey]: HF_SECRETS.supabaseAnonKey,
    [SETTING_KEYS.telegramBotToken]: HF_SECRETS.telegramBotToken,
    [SETTING_KEYS.telegramChatId]: HF_SECRETS.telegramChatId,
    [SETTING_KEYS.finnhubApiKey]: HF_SECRETS.finnhubApiKey,
    [SETTING_KEYS.alphaVantageApiKey]: HF_SECRETS.alphaVantageApiKey,
    [SETTING_KEYS.coinGeckoApiKey]: HF_SECRETS.coinGeckoApiKey,
    [SETTING_KEYS.fmpApiKey]: HF_SECRETS.fmpApiKey,
    [SETTING_KEYS.newsApiKey]: HF_SECRETS.newsApiKey,
  };
  return map[key];
}

/**
 * Get a setting value with env-over-DB resolution.
 *
 * Resolution order:
 *   1. HF Secret env var (if set and non-empty) — highest priority
 *   2. SQLite Setting table (if a row exists with this key)
 *   3. The provided fallback
 *
 * For credential keys (API keys, Supabase creds, password), the env var
 * always wins — this lets users set secrets in HF Space Settings and have
 * them persist across restarts without re-entering in the UI.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  // Layer 1: HF Secret env var override
  const envVal = envOverrideForKey(key);
  if (envVal !== undefined && envVal.length > 0 && !envVal.startsWith('PASTE_')) {
    try {
      return JSON.parse(envVal) as T;
    } catch {
      // Env vars are often plain strings (not JSON) — return as-is if the
      // fallback type is string, otherwise wrap in JSON.
      return (typeof fallback === 'string' ? envVal : envVal) as unknown as T;
    }
  }

  // Layer 2/3: SQLite Setting table
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Set a setting value in the SQLite Setting table.
 * Note: this does NOT set the env var — HF Secrets are managed in the Space
 * Settings UI and can't be written at runtime. If an env var override exists,
 * it will still take precedence over this DB value on the next getSetting().
 */
export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
}

/**
 * Get all settings from the DB (does NOT include env-var overrides).
 * Used by the Settings UI to display editable values. The UI should call
 * getSetting() for individual keys to see the effective (env-overridden) value.
 */
export async function getAllSettings(): Promise<Record<string, any>> {
  const rows = await db.setting.findMany();
  const out: Record<string, any> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

/**
 * Check if a setting key has an active env-var override (HF Secret).
 * The UI uses this to show a "managed by HF Secret" badge next to fields
 * that can't be edited locally.
 */
export function hasEnvOverride(key: string): boolean {
  const v = envOverrideForKey(key);
  return v !== undefined && v.length > 0 && !v.startsWith('PASTE_');
}

// Well-known setting keys
export const SETTING_KEYS = {
  telegramBotToken: 'telegram_bot_token',
  telegramChatId: 'telegram_chat_id',
  finnhubApiKey: 'finnhub_api_key',
  alphaVantageApiKey: 'alpha_vantage_api_key',
  coinGeckoApiKey: 'coingecko_api_key',
  fmpApiKey: 'fmp_api_key',
  newsApiKey: 'news_api_key',
  alertThresholds: 'alert_thresholds', // per-asset: { "BTCUSDT": {minConviction, directions} }
  defaultThreshold: 'default_threshold',
  schedulerEnabled: 'scheduler_enabled',
  lastSchedulerTick: 'last_scheduler_tick',
  supabaseUrl: 'supabase_url',
  supabaseAnonKey: 'supabase_anon_key',
  appPassword: 'app_password',
  // The Lazy Brain — autonomous orchestration + token economy control flags.
  brainState: 'brain_state',
} as const;
