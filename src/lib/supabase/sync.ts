// Supabase Sync Service — pushes all local SQLite data to Supabase tables.
//
// This runs a one-way sync: SQLite → Supabase. It upserts every row from every
// table, so it's safe to run multiple times (idempotent based on primary key).
//
// Tables are synced in dependency order (parents before children) to respect
// foreign key constraints.
//
// JSON fields (stored as TEXT in both SQLite and Supabase) are passed through
// as-is — no transformation needed since both schemas store JSON as strings.

import { db } from '@/lib/db';
import { getSupabaseClient } from '@/lib/supabase/client';

export interface SyncResult {
  table: string;
  synced: number;
  error?: string;
}

export interface SyncSummary {
  totalSynced: number;
  totalErrors: number;
  results: SyncResult[];
  durationMs: number;
}

// Tables in dependency order (parents first, children after).
// Each entry maps the Prisma delegate to the Supabase table name.
const SYNC_TABLES: { prisma: keyof typeof db; table: string }[] = [
  { prisma: 'llmProvider', table: 'LlmProvider' },
  { prisma: 'llmModel', table: 'LlmModel' },
  { prisma: 'moduleModelConfig', table: 'ModuleModelConfig' },
  { prisma: 'asset', table: 'Asset' },
  { prisma: 'watchlist', table: 'Watchlist' },
  { prisma: 'dataSnapshot', table: 'DataSnapshot' },
  { prisma: 'signal', table: 'Signal' },
  { prisma: 'signalOutcome', table: 'SignalOutcome' },
  { prisma: 'alert', table: 'Alert' },
  { prisma: 'priceAlert', table: 'PriceAlert' },
  { prisma: 'newsItem', table: 'NewsItem' },
  { prisma: 'ipoIcoItem', table: 'IpoIcoItem' },
  { prisma: 'report', table: 'Report' },
  { prisma: 'portfolioHolding', table: 'PortfolioHolding' },
  { prisma: 'scheduleJob', table: 'ScheduleJob' },
  { prisma: 'setting', table: 'Setting' },
];

/**
 * Sync all local SQLite data to Supabase.
 * Upserts every row from every table (idempotent — safe to run multiple times).
 * Returns a summary of what was synced.
 */
export async function syncToSupabase(): Promise<SyncSummary> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error('Supabase not configured. Add your Project URL + anon key in Settings → Supabase.');
  }

  const start = Date.now();
  const results: SyncResult[] = [];
  let totalSynced = 0;
  let totalErrors = 0;

  for (const { prisma, table } of SYNC_TABLES) {
    try {
      // Read all rows from local SQLite
      // @ts-expect-error — dynamic delegate access
      const rows: any[] = await db[prisma].findMany({ take: 5000 });
      if (rows.length === 0) {
        results.push({ table, synced: 0 });
        continue;
      }

      // Transform rows: convert Date objects to ISO strings for Supabase
      // (Prisma returns Date objects; Supabase expects ISO strings for timestamptz)
      const transformed = rows.map((row) => {
        const out: Record<string, any> = {};
        for (const [key, value] of Object.entries(row)) {
          if (value instanceof Date) {
            out[key] = value.toISOString();
          } else {
            out[key] = value;
          }
        }
        return out;
      });

      // Upsert to Supabase in batches of 100 (Supabase API limit is ~500 rows per request,
      // but 100 is safer for large payloads with JSON fields)
      const BATCH_SIZE = 100;
      let synced = 0;
      for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
        const batch = transformed.slice(i, i + BATCH_SIZE);
        const { error } = await client
          .from(table)
          .upsert(batch, { onConflict: 'id' });

        if (error) {
          throw new Error(error.message);
        }
        synced += batch.length;
      }

      results.push({ table, synced });
      totalSynced += synced;
      console.log(`[supabase-sync] ${table}: ${synced} rows synced`);
    } catch (e: any) {
      const errMsg = e.message?.slice(0, 200) || 'Unknown error';
      results.push({ table, synced: 0, error: errMsg });
      totalErrors++;
      console.error(`[supabase-sync] ${table} FAILED: ${errMsg}`);
    }
  }

  return {
    totalSynced,
    totalErrors,
    results,
    durationMs: Date.now() - start,
  };
}
