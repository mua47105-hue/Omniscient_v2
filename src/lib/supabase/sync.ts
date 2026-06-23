// Supabase Sync Service — pushes all local SQLite data to Supabase tables.
//
// This runs a one-way sync: SQLite → Supabase. It upserts every row from every
// table using the NATURAL UNIQUE KEY (not 'id') for conflict resolution.
//
// Tables are synced in dependency order (parents before children) to respect
// foreign key constraints.

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

// Tables in dependency order with their natural unique conflict key.
// Using the natural key (name, symbol, key, etc.) instead of 'id' prevents
// "duplicate key value violates unique constraint" errors when the seed
// creates rows with auto-generated IDs that differ from Supabase IDs.
const SYNC_TABLES: { prisma: keyof typeof db; table: string; conflictKey: string }[] = [
  { prisma: 'llmProvider', table: 'LlmProvider', conflictKey: 'name' },
  { prisma: 'llmModel', table: 'LlmModel', conflictKey: 'providerId,modelId' },
  { prisma: 'moduleModelConfig', table: 'ModuleModelConfig', conflictKey: 'moduleKey,layer' },
  { prisma: 'asset', table: 'Asset', conflictKey: 'symbol' },
  { prisma: 'watchlist', table: 'Watchlist', conflictKey: 'name' },
  { prisma: 'scheduleJob', table: 'ScheduleJob', conflictKey: 'moduleKey' },
  { prisma: 'setting', table: 'Setting', conflictKey: 'key' },
  { prisma: 'portfolioHolding', table: 'PortfolioHolding', conflictKey: 'id' },
  { prisma: 'priceAlert', table: 'PriceAlert', conflictKey: 'id' },
  { prisma: 'dataSnapshot', table: 'DataSnapshot', conflictKey: 'id' },
  { prisma: 'signal', table: 'Signal', conflictKey: 'id' },
  { prisma: 'signalOutcome', table: 'SignalOutcome', conflictKey: 'id' },
  { prisma: 'alert', table: 'Alert', conflictKey: 'id' },
  { prisma: 'newsItem', table: 'NewsItem', conflictKey: 'id' },
  { prisma: 'ipoIcoItem', table: 'IpoIcoItem', conflictKey: 'id' },
  { prisma: 'report', table: 'Report', conflictKey: 'type,period' },
];

/**
 * Sync all local SQLite data to Supabase.
 * Upserts every row using the natural unique key for conflict resolution.
 */
export async function syncToSupabase(): Promise<SyncSummary> {
  const client = await getSupabaseClient();
  if (!client) {
    throw new Error('Supabase not configured.');
  }

  const start = Date.now();
  const results: SyncResult[] = [];
  let totalSynced = 0;
  let totalErrors = 0;

  for (const { prisma, table, conflictKey } of SYNC_TABLES) {
    try {
      // @ts-expect-error — dynamic delegate access
      const rows: any[] = await db[prisma].findMany({ take: 5000 });
      if (rows.length === 0) {
        results.push({ table, synced: 0 });
        continue;
      }

      // Transform: convert Date objects to ISO strings
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

      // Upsert using the natural conflict key
      const BATCH_SIZE = 100;
      let synced = 0;
      for (let i = 0; i < transformed.length; i += BATCH_SIZE) {
        const batch = transformed.slice(i, i + BATCH_SIZE);
        const { error } = await client
          .from(table)
          .upsert(batch, { onConflict: conflictKey });

        if (error) {
          throw new Error(error.message);
        }
        synced += batch.length;
      }

      results.push({ table, synced });
      totalSynced += synced;
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
