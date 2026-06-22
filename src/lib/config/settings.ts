// Settings manager — typed wrapper around the Setting KV table.
//
// PERSISTENCE ARCHITECTURE (env-over-DB, per Improvement Plan §2):
//   Layer 1: HF Space Secrets (env vars) — highest priority, persists across restarts
//   Layer 2: SQLite Setting table — editable fallback
//   Layer 3: Hardcoded defaults
//
// getSetting() checks env first, then DB, then returns the fallback.

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

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  // Layer 1: HF Secret env var override (highest priority)
  const envVal = envOverrideForKey(key);
  if (envVal !== undefined && envVal.length > 0 && !envVal.startsWith('PASTE_')) {
    try {
      return JSON.parse(envVal) as T;
    } catch {
      return (typeof fallback === 'string' ? envVal : envVal) as unknown as T;
    }
  }

  // Layer 2: SQLite Setting table
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: JSON.stringify(value) },
    update: { value: JSON.stringify(value) },
  });
}

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

/** Check if a setting key has an active env-var override (HF Secret). */
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
  alertThresholds: 'alert_thresholds',
  defaultThreshold: 'default_threshold',
  schedulerEnabled: 'scheduler_enabled',
  lastSchedulerTick: 'last_scheduler_tick',
  supabaseUrl: 'supabase_url',
  supabaseAnonKey: 'supabase_anon_key',
  appPassword: 'app_password',
  brainState: 'brain_state',
} as const;
