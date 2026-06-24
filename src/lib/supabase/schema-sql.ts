// SQL schema for Supabase — mirrors the Prisma models exactly.
//
// This string is shown in the dashboard (Settings → Supabase) so the user can
// copy-paste it into the Supabase SQL Editor and run it to create all tables.
//
// DESIGN:
// - Uses CREATE TABLE IF NOT EXISTS (safe to re-run — won't drop existing data)
// - Uses ALTER TABLE ADD COLUMN IF NOT EXISTS for any new columns
// - Includes seed data (INSERT ... ON CONFLICT DO NOTHING) for:
//   - 10 LLM providers (Pollinations active + 9 presets with placeholder keys)
//   - 11 crypto assets (BTC, ETH, SOL, etc.)
//   - Default watchlist (Crypto Top 10)
//   - Default settings (alert thresholds, data source placeholder keys)
//   - 3 schedule jobs (crypto_technical enabled)
//   - Module configs wired to Pollinations
// - RLS is DISABLED on all tables (personal dashboard)
// - updated_at trigger keeps "updatedAt" columns current

export const SUPABASE_SCHEMA_SQL = `-- ============================================================
-- OMNISCIENT — Global Market Intelligence System
-- Supabase schema (PostgreSQL) — SAFE TO RE-RUN
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
--
-- This script:
--   1. Creates all 16 tables (IF NOT EXISTS — won't drop existing data)
--   2. Adds any missing columns (ALTER TABLE ADD COLUMN IF NOT EXISTS)
--   3. Seeds default data (providers, assets, watchlists, settings)
--   4. Sets up updated_at triggers
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- LLM PROVIDERS & MODELS
-- ============================================================
create table if not exists "LlmProvider" (
  "id"        text primary key default gen_random_uuid()::text,
  "name"      text unique not null,
  "baseUrl"   text not null,
  "apiKey"    text not null,
  "isActive"  boolean not null default true,
  "notes"     text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists "LlmModel" (
  "id"            text primary key default gen_random_uuid()::text,
  "providerId"    text not null references "LlmProvider"("id") on delete cascade,
  "modelId"       text not null,
  "displayName"   text not null,
  "contextWindow" integer not null default 128000,
  "freeTierRpm"   integer not null default 10,
  "isActive"      boolean not null default true,
  "capabilities"  text not null default 'text',
  "createdAt"     timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now(),
  unique ("providerId", "modelId")
);

create table if not exists "ModuleModelConfig" (
  "id"           text primary key default gen_random_uuid()::text,
  "moduleKey"    text not null,
  "layer"        text not null,
  "modelId"      text not null references "LlmModel"("id") on delete cascade,
  "providerId"   text not null references "LlmProvider"("id") on delete cascade,
  "temperature"  double precision not null default 0.3,
  "systemPrompt" text,
  "enabled"      boolean not null default true,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now(),
  unique ("moduleKey", "layer")
);

-- ============================================================
-- ASSETS & WATCHLISTS
-- ============================================================
create table if not exists "Asset" (
  "id"         text primary key default gen_random_uuid()::text,
  "symbol"     text unique not null,
  "name"       text not null,
  "assetClass" text not null,
  "exchange"   text,
  "meta"       text not null default '{}',
  "isActive"   boolean not null default true,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);

create table if not exists "Watchlist" (
  "id"         text primary key default gen_random_uuid()::text,
  "name"       text unique not null,
  "assetClass" text,
  "symbols"    text not null default '[]',
  "isActive"   boolean not null default true,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);

-- ============================================================
-- DATA SNAPSHOTS
-- ============================================================
create table if not exists "DataSnapshot" (
  "id"        text primary key default gen_random_uuid()::text,
  "assetId"   text not null references "Asset"("id") on delete cascade,
  "timestamp" timestamptz not null default now(),
  "layer"     text not null,
  "source"    text not null,
  "payload"   text not null
);

-- ============================================================
-- SIGNALS & OUTCOMES
-- ============================================================
create table if not exists "Signal" (
  "id"            text primary key default gen_random_uuid()::text,
  "assetId"       text not null references "Asset"("id") on delete cascade,
  "timestamp"     timestamptz not null default now(),
  "direction"     text not null,
  "conviction"    integer not null,
  "timeframe"     text not null default '4h',
  "layersSummary" text not null default '{}',
  "modelsUsed"    text not null default '[]',
  "entryPrice"    double precision,
  "stopLoss"      double precision,
  "takeProfit"    double precision,
  "rationale"     text not null,
  "status"        text not null default 'open',
  "expiresAt"     timestamptz
);

create table if not exists "SignalOutcome" (
  "id"        text primary key default gen_random_uuid()::text,
  "signalId"  text not null references "Signal"("id") on delete cascade,
  "horizon"   text not null,
  "expected"  text not null,
  "actual"    text,
  "pnlPct"    double precision,
  "grade"     text,
  "gradedAt"  timestamptz,
  "createdAt" timestamptz not null default now()
);

-- ============================================================
-- ALERTS (Telegram / email delivery log)
-- ============================================================
create table if not exists "Alert" (
  "id"        text primary key default gen_random_uuid()::text,
  "signalId"  text references "Signal"("id") on delete set null,
  "channel"   text not null,
  "status"    text not null default 'pending',
  "payload"   text not null default '{}',
  "sentAt"    timestamptz,
  "error"     text,
  "createdAt" timestamptz not null default now()
);

-- ============================================================
-- PRICE ALERTS (user-defined threshold alerts)
-- ============================================================
create table if not exists "PriceAlert" (
  "id"           text primary key default gen_random_uuid()::text,
  "assetSymbol"  text not null,
  "condition"    text not null,
  "targetPrice"  double precision not null,
  "currentPrice" double precision,
  "status"       text not null default 'active',
  "channel"      text not null default 'dashboard',
  "note"         text,
  "triggeredAt"  timestamptz,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now()
);
create index if not exists "PriceAlert_assetSymbol_idx" on "PriceAlert"("assetSymbol");
create index if not exists "PriceAlert_status_idx" on "PriceAlert"("status");

-- ============================================================
-- NEWS
-- ============================================================
create table if not exists "NewsItem" (
  "id"          text primary key default gen_random_uuid()::text,
  "source"      text not null,
  "url"         text,
  "title"       text not null,
  "body"        text,
  "publishedAt" timestamptz not null,
  "sentiment"   double precision,
  "impact"      text,
  "assetsTagged" text not null default '[]',
  "analyzed"   boolean not null default false,
  "createdAt"  timestamptz not null default now()
);
create index if not exists "NewsItem_publishedAt_idx" on "NewsItem"("publishedAt");
create index if not exists "NewsItem_source_idx" on "NewsItem"("source");

-- ============================================================
-- IPO / ICO
-- ============================================================
create table if not exists "IpoIcoItem" (
  "id"        text primary key default gen_random_uuid()::text,
  "type"      text not null,
  "name"      text not null,
  "symbol"    text,
  "date"      timestamptz,
  "exchange"  text,
  "details"   text not null default '{}',
  "analysis"  text,
  "createdAt" timestamptz not null default now()
);

-- ============================================================
-- REPORTS
-- ============================================================
create table if not exists "Report" (
  "id"        text primary key default gen_random_uuid()::text,
  "type"      text not null,
  "period"    text not null,
  "title"     text not null,
  "contentMd" text not null,
  "createdAt" timestamptz not null default now(),
  unique ("type", "period")
);

-- ============================================================
-- PORTFOLIO HOLDINGS
-- ============================================================
create table if not exists "PortfolioHolding" (
  "id"          text primary key default gen_random_uuid()::text,
  "assetSymbol" text not null,
  "quantity"    double precision not null,
  "entryPrice"  double precision not null,
  "entryDate"   timestamptz not null default now(),
  "notes"       text,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);
create index if not exists "PortfolioHolding_assetSymbol_idx" on "PortfolioHolding"("assetSymbol");

-- ============================================================
-- SCHEDULER JOBS
-- ============================================================
create table if not exists "ScheduleJob" (
  "id"         text primary key default gen_random_uuid()::text,
  "moduleKey"  text unique not null,
  "cronExpr"   text not null,
  "enabled"    boolean not null default true,
  "lastRunAt"  timestamptz,
  "nextRunAt"  timestamptz,
  "lastStatus" text,
  "lastError"  text,
  "createdAt"  timestamptz not null default now(),
  "updatedAt"  timestamptz not null default now()
);

-- ============================================================
-- SETTINGS (global KV)
-- ============================================================
create table if not exists "Setting" (
  "id"        text primary key default gen_random_uuid()::text,
  "key"       text unique not null,
  "value"     text not null,
  "updatedAt" timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — DISABLED for personal dashboard use.
-- ============================================================
alter table "LlmProvider"       disable row level security;
alter table "LlmModel"          disable row level security;
alter table "ModuleModelConfig" disable row level security;
alter table "Asset"             disable row level security;
alter table "Watchlist"         disable row level security;
alter table "DataSnapshot"      disable row level security;
alter table "Signal"            disable row level security;
alter table "SignalOutcome"     disable row level security;
alter table "Alert"             disable row level security;
alter table "PriceAlert"        disable row level security;
alter table "NewsItem"          disable row level security;
alter table "IpoIcoItem"        disable row level security;
alter table "Report"            disable row level security;
alter table "PortfolioHolding"  disable row level security;
alter table "ScheduleJob"       disable row level security;
alter table "Setting"           disable row level security;

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists "LlmProvider_updatedAt"  on "LlmProvider";
create trigger "LlmProvider_updatedAt"  before update on "LlmProvider"       for each row execute function set_updated_at();

drop trigger if exists "LlmModel_updatedAt"     on "LlmModel";
create trigger "LlmModel_updatedAt"     before update on "LlmModel"          for each row execute function set_updated_at();

drop trigger if exists "ModuleModelConfig_updatedAt" on "ModuleModelConfig";
create trigger "ModuleModelConfig_updatedAt" before update on "ModuleModelConfig" for each row execute function set_updated_at();

drop trigger if exists "Asset_updatedAt"        on "Asset";
create trigger "Asset_updatedAt"        before update on "Asset"             for each row execute function set_updated_at();

drop trigger if exists "Watchlist_updatedAt"    on "Watchlist";
create trigger "Watchlist_updatedAt"    before update on "Watchlist"         for each row execute function set_updated_at();

drop trigger if exists "PriceAlert_updatedAt"   on "PriceAlert";
create trigger "PriceAlert_updatedAt"   before update on "PriceAlert"        for each row execute function set_updated_at();

drop trigger if exists "PortfolioHolding_updatedAt" on "PortfolioHolding";
create trigger "PortfolioHolding_updatedAt" before update on "PortfolioHolding" for each row execute function set_updated_at();

drop trigger if exists "ScheduleJob_updatedAt"  on "ScheduleJob";
create trigger "ScheduleJob_updatedAt"  before update on "ScheduleJob"       for each row execute function set_updated_at();

drop trigger if exists "Setting_updatedAt"      on "Setting";
create trigger "Setting_updatedAt"      before update on "Setting"           for each row execute function set_updated_at();

-- ============================================================
-- SEED DATA — default providers, assets, watchlists, settings
-- Uses ON CONFLICT DO NOTHING so re-running won't overwrite user changes.
-- ============================================================

-- 1. Pollinations (free, no key, ACTIVE by default)
insert into "LlmProvider" ("name", "baseUrl", "apiKey", "isActive", "notes")
values ('Pollinations', 'https://text.pollinations.ai/openai', 'pollinations-free', true, 'Free LLM, NO API KEY needed. Model: openai (gpt-oss-20b).')
on conflict ("name") do nothing;

-- 2. Preset providers (inactive until user pastes a real key)
insert into "LlmProvider" ("name", "baseUrl", "apiKey", "isActive", "notes")
values
  ('OpenRouter', 'https://openrouter.ai/api/v1', 'PASTE_YOUR_OPENROUTER_API_KEY', false, 'Aggregates 100+ models. Get key: openrouter.ai/keys'),
  ('Groq', 'https://api.groq.com/openai/v1', 'PASTE_YOUR_GROQ_API_KEY', false, 'Ultra-fast inference (500+ tok/s). Get key: console.groq.com/keys'),
  ('Gemini', 'https://generativelanguage.googleapis.com/v1beta', 'PASTE_YOUR_GEMINI_API_KEY', false, 'Google Gemini. Free tier: 15 RPM. Get key: aistudio.google.com/app/apikey'),
  ('Mistral', 'https://api.mistral.ai/v1', 'PASTE_YOUR_MISTRAL_API_KEY', false, 'Mistral AI. Get key: console.mistral.ai/api-keys'),
  ('NVIDIA NIM', 'https://integrate.api.nvidia.com/v1', 'PASTE_YOUR_NVIDIA_API_KEY', false, 'NVIDIA NIM. Get key: build.nvidia.com'),
  ('Cerebras', 'https://api.cerebras.ai/v1', 'PASTE_YOUR_CEREBRAS_API_KEY', false, 'Fastest inference (2000+ tok/s). Get key: cloud.cerebras.ai'),
  ('DeepSeek', 'https://api.deepseek.com/v1', 'PASTE_YOUR_DEEPSEEK_API_KEY', false, 'Very cheap ($0.27/M tokens). Get key: platform.deepseek.com/api_keys'),
  ('xAI Grok', 'https://api.x.ai/v1', 'PASTE_YOUR_XAI_API_KEY', false, 'Grok. $25 free credit/month. Get key: console.x.ai'),
  ('Together AI', 'https://api.together.xyz/v1', 'PASTE_YOUR_TOGETHER_API_KEY', false, '200+ open-source models. Get key: api.together.ai')
on conflict ("name") do nothing;

-- 3. Pollinations model
insert into "LlmModel" ("providerId", "modelId", "displayName", "contextWindow", "freeTierRpm", "capabilities")
select p."id", 'openai', 'OpenAI (gpt-oss-20b)', 128000, 60, '["text","json"]'
from "LlmProvider" p where p."name" = 'Pollinations'
and not exists (select 1 from "LlmModel" m where m."providerId" = p."id" and m."modelId" = 'openai');

-- 4. Module configs wired to Pollinations
insert into "ModuleModelConfig" ("moduleKey", "layer", "modelId", "providerId", "temperature", "enabled")
select c.module_key, c.layer, m."id", p."id", 0.3, true
from "LlmProvider" p
join "LlmModel" m on m."providerId" = p."id"
cross join (values
  ('crypto_technical', 'deep_reasoning'),
  ('news_sentiment', 'sentiment'),
  ('macro_analysis', 'macro')
) as c(module_key, layer)
where p."name" = 'Pollinations'
on conflict ("moduleKey", "layer") do nothing;

-- 5. Crypto assets
insert into "Asset" ("symbol", "name", "assetClass", "exchange", "meta")
values
  ('BTCUSDT', 'Bitcoin', 'crypto', 'binance', '{"coinId":"bitcoin"}'),
  ('ETHUSDT', 'Ethereum', 'crypto', 'binance', '{"coinId":"ethereum"}'),
  ('SOLUSDT', 'Solana', 'crypto', 'binance', '{"coinId":"solana"}'),
  ('BNBUSDT', 'BNB', 'crypto', 'binance', '{"coinId":"binancecoin"}'),
  ('XRPUSDT', 'XRP', 'crypto', 'binance', '{"coinId":"ripple"}'),
  ('ADAUSDT', 'Cardano', 'crypto', 'binance', '{"coinId":"cardano"}'),
  ('DOGEUSDT', 'Dogecoin', 'crypto', 'binance', '{"coinId":"dogecoin"}'),
  ('AVAXUSDT', 'Avalanche', 'crypto', 'binance', '{"coinId":"avalanche-2"}'),
  ('LINKUSDT', 'Chainlink', 'crypto', 'binance', '{"coinId":"chainlink"}'),
  ('MATICUSDT', 'Polygon', 'crypto', 'binance', '{"coinId":"matic-network"}'),
  ('POLUSDT', 'Polygon', 'crypto', 'binance', '{"coinId":"matic-network"}')
on conflict ("symbol") do nothing;

-- 6. Default watchlist
insert into "Watchlist" ("name", "assetClass", "symbols", "isActive")
values ('Crypto Top 10', 'crypto', '["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT","MATICUSDT","POLUSDT"]', true)
on conflict ("name") do nothing;

-- 7. Default settings
insert into "Setting" ("key", "value")
values
  ('default_threshold', '{"minConviction":60,"directions":["long","short"]}'),
  ('alert_thresholds', '{}'),
  ('finnhub_api_key', '"PASTE_YOUR_FINNHUB_API_KEY"'),
  ('alpha_vantage_api_key', '"PASTE_YOUR_ALPHA_VANTAGE_API_KEY"'),
  ('twelvedata_api_key', '"PASTE_YOUR_TWELVEDATA_API_KEY"'),
  ('tiingo_api_key', '"PASTE_YOUR_TIINGO_API_KEY"'),
  ('coingecko_api_key', '"PASTE_YOUR_COINGECKO_API_KEY"'),
  ('fmp_api_key', '"PASTE_YOUR_FMP_API_KEY"'),
  ('news_api_key', '"PASTE_YOUR_NEWS_API_KEY"')
on conflict ("key") do nothing;

-- 8. Schedule jobs
insert into "ScheduleJob" ("moduleKey", "cronExpr", "enabled")
values
  ('crypto_technical', '*/15 * * * *', true),
  ('news_sentiment', '*/30 * * * *', false),
  ('macro_analysis', '0 * * * *', false)
on conflict ("moduleKey") do nothing;

-- ============================================================
-- Done. The app will now pull this data on startup via the
-- bootstrap sync (src/lib/sync/bootstrap.ts → instrumentation.ts).
-- ============================================================
`;

/** The list of table names created by the schema — used for status display. */
export const SUPABASE_TABLES = [
  'LlmProvider',
  'LlmModel',
  'ModuleModelConfig',
  'Asset',
  'Watchlist',
  'DataSnapshot',
  'Signal',
  'SignalOutcome',
  'Alert',
  'PriceAlert',
  'NewsItem',
  'IpoIcoItem',
  'Report',
  'PortfolioHolding',
  'ScheduleJob',
  'Setting',
] as const;
