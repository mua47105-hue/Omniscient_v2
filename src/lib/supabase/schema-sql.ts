// SQL schema for Supabase — mirrors the Prisma models exactly.
//
// This string is shown in the dashboard (Settings → Supabase) so the user can
// copy-paste it into the Supabase SQL Editor and run it to create all tables.
//
// Design notes:
// - Uses PostgreSQL-native types (TEXT, TIMESTAMP, BOOLEAN, DOUBLE PRECISION, BIGINT).
// - JSON columns are TEXT (we store JSON strings, same as the Prisma/SQLite dev DB).
// - cuid() IDs are generated client-side and stored as TEXT.
// - Foreign keys + cascading deletes match the Prisma relations.
// - Indexes match the @@index directives in the Prisma schema.
// - RLS is DISABLED on all tables — this is a personal dashboard, not a multi-tenant app.
//   If you need RLS, enable it and add policies for the `anon` role.

export const SUPABASE_SCHEMA_SQL = `-- ============================================================
-- OMNISCIENT — Global Market Intelligence System
-- Supabase schema (PostgreSQL)
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- ============================================================

-- Extensions
create extension if not exists "pgcrypto";

-- ============================================================
-- Drop existing tables (safe re-run — comment out if you have data)
-- ============================================================
drop table if exists "SignalOutcome" cascade;
drop table if exists "Alert" cascade;
drop table if exists "Signal" cascade;
drop table if exists "DataSnapshot" cascade;
drop table if exists "PriceAlert" cascade;
drop table if exists "NewsItem" cascade;
drop table if exists "IpoIcoItem" cascade;
drop table if exists "Report" cascade;
drop table if exists "PortfolioHolding" cascade;
drop table if exists "ScheduleJob" cascade;
drop table if exists "Watchlist" cascade;
drop table if exists "Asset" cascade;
drop table if exists "ModuleModelConfig" cascade;
drop table if exists "LlmModel" cascade;
drop table if exists "LlmProvider" cascade;
drop table if exists "Setting" cascade;

-- ============================================================
-- LLM PROVIDERS & MODELS
-- ============================================================
create table "LlmProvider" (
  "id"        text primary key default gen_random_uuid()::text,
  "name"      text unique not null,
  "baseUrl"   text not null,
  "apiKey"    text not null,
  "isActive"  boolean not null default true,
  "notes"     text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table "LlmModel" (
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

create table "ModuleModelConfig" (
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
create table "Asset" (
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

create table "Watchlist" (
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
create table "DataSnapshot" (
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
create table "Signal" (
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

create table "SignalOutcome" (
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
create table "Alert" (
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
create table "PriceAlert" (
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
create index "PriceAlert_assetSymbol_idx" on "PriceAlert"("assetSymbol");
create index "PriceAlert_status_idx" on "PriceAlert"("status");

-- ============================================================
-- NEWS
-- ============================================================
create table "NewsItem" (
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
create index "NewsItem_publishedAt_idx" on "NewsItem"("publishedAt");
create index "NewsItem_source_idx" on "NewsItem"("source");

-- ============================================================
-- IPO / ICO
-- ============================================================
create table "IpoIcoItem" (
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
create table "Report" (
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
create table "PortfolioHolding" (
  "id"          text primary key default gen_random_uuid()::text,
  "assetSymbol" text not null,
  "quantity"    double precision not null,
  "entryPrice"  double precision not null,
  "entryDate"   timestamptz not null default now(),
  "notes"       text,
  "createdAt"   timestamptz not null default now(),
  "updatedAt"   timestamptz not null default now()
);
create index "PortfolioHolding_assetSymbol_idx" on "PortfolioHolding"("assetSymbol");

-- ============================================================
-- SCHEDULER JOBS
-- ============================================================
create table "ScheduleJob" (
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
create table "Setting" (
  "id"        text primary key default gen_random_uuid()::text,
  "key"       text unique not null,
  "value"     text not null,
  "updatedAt" timestamptz not null default now()
);

-- ============================================================
-- Row Level Security — DISABLED for personal dashboard use.
-- The anon key can read/write all tables directly.
-- If you want RLS, uncomment the block below and add policies.
-- ============================================================
-- enable row level security on all tables;
-- (by default, with RLS enabled and no policies, the anon role cannot access anything)
-- For a personal dashboard, leaving RLS disabled is simplest.

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
-- updated_at trigger — keeps "updatedAt" columns current on UPDATE.
-- NOTE: the function name is unquoted lowercase (set_updated_at) so PostgreSQL
-- treats it case-insensitively. The column name "updatedAt" inside the body
-- stays quoted because that column IS mixed-case.
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$ language plpgsql;

create trigger "LlmProvider_updatedAt"  before update on "LlmProvider"       for each row execute function set_updated_at();
create trigger "LlmModel_updatedAt"     before update on "LlmModel"          for each row execute function set_updated_at();
create trigger "ModuleModelConfig_updatedAt" before update on "ModuleModelConfig" for each row execute function set_updated_at();
create trigger "Asset_updatedAt"        before update on "Asset"             for each row execute function set_updated_at();
create trigger "Watchlist_updatedAt"    before update on "Watchlist"         for each row execute function set_updated_at();
create trigger "PriceAlert_updatedAt"   before update on "PriceAlert"        for each row execute function set_updated_at();
create trigger "PortfolioHolding_updatedAt" before update on "PortfolioHolding" for each row execute function set_updated_at();
create trigger "ScheduleJob_updatedAt"  before update on "ScheduleJob"       for each row execute function set_updated_at();
create trigger "Setting_updatedAt"      before update on "Setting"           for each row execute function set_updated_at();

-- ============================================================
-- Done. You can now connect the dashboard using your Project URL + anon key.
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
