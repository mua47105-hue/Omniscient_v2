// Supabase Sync Service — pushes all local SQLite data to Supabase tables.
//
// This runs a one-way sync: SQLite → Supabase. It upserts every row from every
// table using the NATURAL UNIQUE KEY (not 'id') for conflict resolution.
//
// CRITICAL: For tables with foreign keys (LlmModel, ModuleModelConfig,
// DataSnapshot, Signal), the local IDs (auto-generated cuids) differ from
// the Supabase IDs. The sync must resolve local IDs to Supabase IDs by
// looking up the parent row by its natural key before upserting the child.

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

/**
 * Build a map of local provider name → Supabase provider ID.
 * This lets us resolve foreign keys when syncing LlmModel and ModuleModelConfig.
 */
async function buildProviderIdMap(client: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await client.from('LlmProvider').select('id,name');
  if (data) {
    for (const row of data) {
      map.set(row.name, row.id);
    }
  }
  return map;
}

/**
 * Build a map of (providerId,modelId) → Supabase model ID.
 * Uses the provider's Supabase ID (not the local ID) for the lookup.
 */
async function buildModelIdMap(client: any, providerIdMap: Map<string, string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await client.from('LlmModel').select('id,providerId,modelId');
  if (data) {
    for (const row of data) {
      map.set(`${row.providerId}:${row.modelId}`, row.id);
    }
  }
  return map;
}

/**
 * Build a map of local provider name → local provider ID (for reverse lookup).
 */
async function buildLocalProviderMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const providers = await db.llmProvider.findMany({ select: { id: true, name: true } });
  for (const p of providers) {
    map.set(p.id, p.name);
  }
  return map;
}

/**
 * Build a map of local model (providerId,modelId) → local model ID.
 */
async function buildLocalModelMap(): Promise<Map<string, { id: string; providerId: string; modelId: string }>> {
  const map = new Map<string, { id: string; providerId: string; modelId: string }>();
  const models = await db.llmModel.findMany({ select: { id: true, providerId: true, modelId: true } });
  for (const m of models) {
    map.set(m.id, { id: m.id, providerId: m.providerId, modelId: m.modelId });
  }
  return map;
}

/**
 * Build a map of symbol → Supabase Asset ID (queried from Supabase's Asset table).
 * Used to resolve assetId foreign keys in DataSnapshot and Signal.
 */
async function buildSupabaseAssetIdMap(client: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await client.from('Asset').select('id,symbol');
  if (data) {
    for (const row of data) {
      map.set(row.symbol, row.id);
    }
  }
  return map;
}

/**
 * Build a map of local SQLite Asset ID → symbol (queried from local SQLite).
 * Used to look up the symbol for a given local assetId when syncing DataSnapshot and Signal.
 */
async function buildLocalAssetIdMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const assets = await db.asset.findMany({ select: { id: true, symbol: true } });
  for (const a of assets) {
    map.set(a.id, a.symbol);
  }
  return map;
}

/**
 * Sync all local SQLite data to Supabase.
 * Upserts every row using the natural unique key for conflict resolution.
 * For FK tables, resolves local IDs to Supabase IDs before upserting.
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

  // Helper: transform dates to ISO strings
  function transformRow(row: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) {
        out[key] = value.toISOString();
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  // Helper: upsert a batch
  async function upsertBatch(table: string, batch: any[], conflictKey: string): Promise<number> {
    const { error } = await client.from(table).upsert(batch, { onConflict: conflictKey });
    if (error) throw new Error(error.message);
    return batch.length;
  }

  // --- 1. LlmProvider (parent — upsert by name) ---
  try {
    const rows = await db.llmProvider.findMany({ take: 5000 });
    if (rows.length > 0) {
      const transformed = rows.map(transformRow);
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch('LlmProvider', transformed.slice(i, i + 100), 'name');
      }
      results.push({ table: 'LlmProvider', synced });
      totalSynced += synced;
    } else {
      results.push({ table: 'LlmProvider', synced: 0 });
    }
  } catch (e: any) {
    results.push({ table: 'LlmProvider', synced: 0, error: e.message?.slice(0, 200) });
    totalErrors++;
    console.error(`[supabase-sync] LlmProvider FAILED: ${e.message?.slice(0, 200)}`);
  }

  // Build ID maps for FK resolution
  const providerIdMap = await buildProviderIdMap(client); // name → Supabase ID
  const localProviderMap = await buildLocalProviderMap(); // local ID → name

  // --- 2. LlmModel (child — resolve providerId FK by name) ---
  try {
    const rows = await db.llmModel.findMany({ take: 5000 });
    if (rows.length > 0) {
      // Resolve local providerId → Supabase providerId via provider name
      const transformed = rows.map((row) => {
        const out = transformRow(row);
        const providerName = localProviderMap.get(row.providerId);
        if (providerName && providerIdMap.has(providerName)) {
          out.providerId = providerIdMap.get(providerName); // Use Supabase provider ID
        }
        return out;
      });
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch('LlmModel', transformed.slice(i, i + 100), 'providerId,modelId');
      }
      results.push({ table: 'LlmModel', synced });
      totalSynced += synced;
    } else {
      results.push({ table: 'LlmModel', synced: 0 });
    }
  } catch (e: any) {
    results.push({ table: 'LlmModel', synced: 0, error: e.message?.slice(0, 200) });
    totalErrors++;
    console.error(`[supabase-sync] LlmModel FAILED: ${e.message?.slice(0, 200)}`);
  }

  // Build model ID map for ModuleModelConfig FK resolution
  const modelIdMap = await buildModelIdMap(client, providerIdMap); // Supabase providerId:modelId → Supabase model ID
  const localModelMap = await buildLocalModelMap(); // local model ID → {id, providerId, modelId}

  // --- 3. ModuleModelConfig (child — resolve modelId + providerId FKs) ---
  try {
    const rows = await db.moduleModelConfig.findMany({ take: 5000 });
    if (rows.length > 0) {
      const transformed = rows.map((row) => {
        const out = transformRow(row);
        // Resolve providerId
        const providerName = localProviderMap.get(row.providerId);
        if (providerName && providerIdMap.has(providerName)) {
          out.providerId = providerIdMap.get(providerName);
        }
        // Resolve modelId — find the Supabase model ID that matches the local model's (providerId, modelId)
        const localModel = localModelMap.get(row.modelId);
        if (localModel) {
          const localProviderName = localProviderMap.get(localModel.providerId);
          const supabaseProviderId = localProviderName ? providerIdMap.get(localProviderName) : undefined;
          if (supabaseProviderId) {
            const supabaseModelId = modelIdMap.get(`${supabaseProviderId}:${localModel.modelId}`);
            if (supabaseModelId) {
              out.modelId = supabaseModelId;
            }
          }
        }
        return out;
      });
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch('ModuleModelConfig', transformed.slice(i, i + 100), 'moduleKey,layer');
      }
      results.push({ table: 'ModuleModelConfig', synced });
      totalSynced += synced;
    } else {
      results.push({ table: 'ModuleModelConfig', synced: 0 });
    }
  } catch (e: any) {
    results.push({ table: 'ModuleModelConfig', synced: 0, error: e.message?.slice(0, 200) });
    totalErrors++;
    console.error(`[supabase-sync] ModuleModelConfig FAILED: ${e.message?.slice(0, 200)}`);
  }

  // --- 4. Simple tables (no FK resolution needed) ---
  // NOTE: DataSnapshot and Signal are NOT here — they have assetId FKs that
  // need resolution. They are synced separately below.
  const simpleTables: { prisma: keyof typeof db; table: string; conflictKey: string }[] = [
    { prisma: 'asset', table: 'Asset', conflictKey: 'symbol' },
    { prisma: 'watchlist', table: 'Watchlist', conflictKey: 'name' },
    { prisma: 'scheduleJob', table: 'ScheduleJob', conflictKey: 'moduleKey' },
    { prisma: 'setting', table: 'Setting', conflictKey: 'key' },
    { prisma: 'portfolioHolding', table: 'PortfolioHolding', conflictKey: 'id' },
    { prisma: 'priceAlert', table: 'PriceAlert', conflictKey: 'id' },
    { prisma: 'signalOutcome', table: 'SignalOutcome', conflictKey: 'id' },
    { prisma: 'alert', table: 'Alert', conflictKey: 'id' },
    { prisma: 'newsItem', table: 'NewsItem', conflictKey: 'id' },
    { prisma: 'ipoIcoItem', table: 'IpoIcoItem', conflictKey: 'id' },
    { prisma: 'report', table: 'Report', conflictKey: 'type,period' },
  ];

  for (const { prisma, table, conflictKey } of simpleTables) {
    try {
      // @ts-expect-error — dynamic delegate access
      const rows: any[] = await db[prisma].findMany({ take: 5000 });
      if (rows.length === 0) {
        results.push({ table, synced: 0 });
        continue;
      }
      const transformed = rows.map(transformRow);
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch(table, transformed.slice(i, i + 100), conflictKey);
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

  // --- 5. Build asset ID maps for DataSnapshot and Signal FK resolution ---
  const supabaseAssetIdMap = await buildSupabaseAssetIdMap(client); // symbol → Supabase Asset ID
  const localAssetIdMap = await buildLocalAssetIdMap(); // local Asset ID → symbol

  // --- 6. DataSnapshot (child — resolve assetId FK by symbol) ---
  try {
    const rows = await db.dataSnapshot.findMany({ take: 5000 });
    if (rows.length > 0) {
      // Resolve each row's local assetId → symbol → Supabase assetId.
      // Rows where the assetId can't be resolved are skipped (graceful handling).
      const transformed: any[] = [];
      let skipped = 0;
      for (const row of rows) {
        const out = transformRow(row);
        const symbol = localAssetIdMap.get(row.assetId);
        if (!symbol) { skipped++; continue; }
        const supabaseAssetId = supabaseAssetIdMap.get(symbol);
        if (!supabaseAssetId) { skipped++; continue; }
        out.assetId = supabaseAssetId;
        transformed.push(out);
      }
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch('DataSnapshot', transformed.slice(i, i + 100), 'id');
      }
      results.push({ table: 'DataSnapshot', synced });
      totalSynced += synced;
      if (skipped > 0) console.log(`[supabase-sync] DataSnapshot: ${skipped} rows skipped (unresolved assetId)`);
    } else {
      results.push({ table: 'DataSnapshot', synced: 0 });
    }
  } catch (e: any) {
    results.push({ table: 'DataSnapshot', synced: 0, error: e.message?.slice(0, 200) });
    totalErrors++;
    console.error(`[supabase-sync] DataSnapshot FAILED: ${e.message?.slice(0, 200)}`);
  }

  // --- 7. Signal (child — resolve assetId FK by symbol) ---
  try {
    const rows = await db.signal.findMany({ take: 5000 });
    if (rows.length > 0) {
      const transformed: any[] = [];
      let skipped = 0;
      for (const row of rows) {
        const out = transformRow(row);
        const symbol = localAssetIdMap.get(row.assetId);
        if (!symbol) { skipped++; continue; }
        const supabaseAssetId = supabaseAssetIdMap.get(symbol);
        if (!supabaseAssetId) { skipped++; continue; }
        out.assetId = supabaseAssetId;
        transformed.push(out);
      }
      let synced = 0;
      for (let i = 0; i < transformed.length; i += 100) {
        synced += await upsertBatch('Signal', transformed.slice(i, i + 100), 'id');
      }
      results.push({ table: 'Signal', synced });
      totalSynced += synced;
      if (skipped > 0) console.log(`[supabase-sync] Signal: ${skipped} rows skipped (unresolved assetId)`);
    } else {
      results.push({ table: 'Signal', synced: 0 });
    }
  } catch (e: any) {
    results.push({ table: 'Signal', synced: 0, error: e.message?.slice(0, 200) });
    totalErrors++;
    console.error(`[supabase-sync] Signal FAILED: ${e.message?.slice(0, 200)}`);
  }

  return {
    totalSynced,
    totalErrors,
    results,
    durationMs: Date.now() - start,
  };
}
