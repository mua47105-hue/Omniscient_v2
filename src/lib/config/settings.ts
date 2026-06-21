/**
 * Setting KV-table wrapper.
 *
 * All values are stored as String (TEXT) in the Setting table — keeps the
 * schema identical across SQLite + PostgreSQL. JSON values are stringified on
 * write and JSON.parse'd on read. Plain strings are stored verbatim.
 */
import db from '@/lib/db';

export const SETTING_KEYS = {
  telegramBotToken: 'telegram.bot_token',
  telegramChatId: 'telegram.chat_id',
  finnhubApiKey: 'finnhub.api_key',
  alertThresholds: 'alert.thresholds',
  defaultThreshold: 'alert.default_threshold',
  schedulerEnabled: 'scheduler.enabled',
  lastSchedulerTick: 'scheduler.last_tick',
  supabaseUrl: 'supabase.url',
  supabaseAnonKey: 'supabase.anon_key',
  appPassword: 'app.password',
  brainState: 'brain.state',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/**
 * Read a setting from the KV table. JSON-parses if the value looks like JSON.
 * Falls back to `defaultValue` on missing row or parse error.
 */
export async function getSetting<T = string>(
  key: SettingKey | string,
  defaultValue?: T,
): Promise<T | undefined> {
  try {
    const row = await db.setting.findUnique({ where: { key: key as string } });
    if (!row) return defaultValue;
    const raw = row.value;
    if (raw == null || raw === '') return defaultValue;
    // Try JSON first; fall back to raw string.
    if (raw.startsWith('{') || raw.startsWith('[') || raw === 'true' || raw === 'false' || /^-?\d/.test(raw)) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        /* not JSON — return raw string */
      }
    }
    return raw as unknown as T;
  } catch (err) {
    console.error(`[settings] getSetting(${key}) failed:`, err);
    return defaultValue;
  }
}

/**
 * Write a setting. Objects/arrays/booleans/numbers are JSON-stringified.
 */
export async function setSetting<T = unknown>(
  key: SettingKey | string,
  value: T,
): Promise<void> {
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value);
  try {
    await db.setting.upsert({
      where: { key: key as string },
      create: { key: key as string, value: serialized },
      update: { value: serialized },
    });
  } catch (err) {
    console.error(`[settings] setSetting(${key}) failed:`, err);
  }
}

/**
 * Return all settings as a plain object (key → parsed value).
 */
export async function getAllSettings(): Promise<Record<string, unknown>> {
  try {
    const rows = await db.setting.findMany();
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      const raw = row.value;
      if (raw == null || raw === '') {
        out[row.key] = null;
        continue;
      }
      if (
        raw.startsWith('{') ||
        raw.startsWith('[') ||
        raw === 'true' ||
        raw === 'false' ||
        /^-?\d/.test(raw)
      ) {
        try {
          out[row.key] = JSON.parse(raw);
          continue;
        } catch {
          /* fall through */
        }
      }
      out[row.key] = raw;
    }
    return out;
  } catch (err) {
    console.error('[settings] getAllSettings failed:', err);
    return {};
  }
}
