// Runtime environment detection — Hugging Face Spaces + persistent storage.
//
// This module centralizes all environment detection so the rest of the app
// can ask "are we on HF Spaces?" and "where should the DB live?" without
// duplicating env-var checks everywhere.
//
// HF Spaces injects these env vars automatically (no setup needed):
//   SPACE_ID            e.g. "user/omniscient"  ← present iff running on HF
//   SPACE_AUTHOR_NAME   e.g. "user"
//   SPACE_REPO_NAME     e.g. "omniscient"
//   SPACE_HOST          e.g. "user-omniscient.hf.space"
//   ACCELERATOR         e.g. "t4-medium" or "none"

/** True when running on Hugging Face Spaces (any Space, any SDK). */
export const IS_HF_SPACE = typeof process !== 'undefined' && !!process.env.SPACE_ID;

/** The HF Space ID in "user/repo" format, or null if not on HF. */
export const HF_SPACE_ID = process.env.SPACE_ID ?? null;

/** The HF Space host URL, or null. */
export const HF_SPACE_HOST = process.env.SPACE_HOST ?? null;

/** The accelerator type (e.g. "t4-medium", "cpu-basic", "none"), or null. */
export const HF_ACCELERATOR = process.env.ACCELERATOR ?? null;

/**
 * The persistent data directory. On HF Spaces this is `/data` (the Storage
 * Bucket mount point). Locally, falls back to the project root.
 */
export const PERSISTENT_DIR =
  typeof process !== 'undefined' && process.env.PERSISTENT_DIR
    ? process.env.PERSISTENT_DIR
    : IS_HF_SPACE
      ? '/data'
      : process.cwd();

/**
 * The SQLite database path. Honors DATABASE_URL if set (HF Space Variable or
 * Secret can override this to point at /data). Defaults to /data on HF,
 * ./db/custom.db locally.
 */
export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (IS_HF_SPACE) return 'file:/data/custom.db';
  return 'file:./db/custom.db';
}

/**
 * Map of well-known HF Space Secret names to their env-var values.
 * Returns undefined for secrets that aren't set. This is the "Layer 1"
 * of the persistence architecture — HF Secrets override everything else.
 *
 * Users set these in Space Settings → Secrets:
 *   APP_PASSWORD              — app lock password (overrides default)
 *   SUPABASE_URL              — https://xxx.supabase.co
 *   SUPABASE_ANON_KEY         — eyJ... (public anon key)
 *   SUPABASE_SERVICE_ROLE_KEY — eyJ... (server-side admin, optional)
 *   OPENROUTER_API_KEY        — sk-or-...
 *   GROQ_API_KEY              — gsk_...
 *   GEMINI_API_KEY            — AIza...
 *   MISTRAL_API_KEY           — ...
 *   NVIDIA_NIM_API_KEY        — nvapi-...
 *   TELEGRAM_BOT_TOKEN        — 123:ABC...
 *   TELEGRAM_CHAT_ID          — -100...
 *   FINNHUB_API_KEY           — ...
 *   ALPHA_VANTAGE_API_KEY     — ...
 *   COINGECKO_API_KEY         — ...
 *   FMP_API_KEY               — ...
 *   NEWS_API_KEY              — ...
 *   CRON_SECRET               — shared secret for scheduler service auth
 *   SESSION_SECRET            — secret for signing session cookies
 */
export const HF_SECRETS = {
  appPassword: process.env.APP_PASSWORD,
  sessionSecret: process.env.SESSION_SECRET,
  cronSecret: process.env.CRON_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  groqApiKey: process.env.GROQ_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  mistralApiKey: process.env.MISTRAL_API_KEY,
  nvidiaNimApiKey: process.env.NVIDIA_NIM_API_KEY,
  cerebrasApiKey: process.env.CEREBRAS_API_KEY,
  aimlApiKey: process.env.AIMLAPI_API_KEY,
  siliconFlowApiKey: process.env.SILICONFLOW_API_KEY,
  xaiApiKey: process.env.XAI_API_KEY,
  huggingFaceApiKey: process.env.HUGGINGFACE_API_KEY,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  finnhubApiKey: process.env.FINNHUB_API_KEY,
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
  coinGeckoApiKey: process.env.COINGECKO_API_KEY,
  fmpApiKey: process.env.FMP_API_KEY,
  newsApiKey: process.env.NEWS_API_KEY,
  twelveDataApiKey: process.env.TWELVEDATA_API_KEY,
  tiingoApiKey: process.env.TIINGO_API_KEY,
} as const;

/**
 * Check if any HF Secret is set (used to decide whether to attempt Supabase
 * bootstrap sync on startup).
 */
export function hasHfSecrets(): boolean {
  return Object.values(HF_SECRETS).some((v) => v && v.length > 0);
}
