// Settings manager — typed wrapper around the Setting KV table.

import { db } from '@/lib/db';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
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
