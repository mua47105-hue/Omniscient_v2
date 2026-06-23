// Bootstrap sync — pulls ALL data from Supabase into local SQLite on startup.
//
// WHY THIS EXISTS:
// On Hugging Face Spaces, the container filesystem is EPHEMERAL — every
// restart/rebuild wipes /app and re-seeds the SQLite DB from scratch. This
// means all user-configured settings (LLM API keys, watchlists, alert
// thresholds, module configs) are lost unless they're stored somewhere
// persistent.
//
// The persistence stack (in priority order):
//   1. HF Space Secrets (env vars) — for credentials. Handled by getSetting()
//      env-over-DB resolution. No sync needed.
//   2. Supabase (ALL tables) — on startup, we pull every table from Supabase
//      and upsert it into local SQLite. This restores the FULL app state
//      (providers, models, configs, assets, watchlists, settings, etc.).
//   3. Local SQLite on /data (HF Storage Bucket) — persists across restarts
//      when the DB lives on the mounted volume.
//
// IMPORTANT: Upserts use the NATURAL UNIQUE KEY (name, symbol, key, etc.)
// instead of the `id` field. This is because the seed script creates rows
// with auto-generated cuid IDs, and Supabase rows may have different IDs.
// If we upserted by `id`, we'd get "Unique constraint failed on (name)"
// because the seed already created a row with that name but a different ID.
// By upserting by the natural key, we update the existing row in place.

import { getSupabaseClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';

let bootstrapRan = false;
let bootstrapResult: { ok: boolean; synced: number; error?: string; details?: string[] } | null = null;

/**
 * Pull all data from Supabase and upsert it into local SQLite.
 * Safe to call multiple times — only runs once per process (guarded by
 * bootstrapRan flag). Called from instrumentation.ts on app startup.
 */
export async function bootstrapSettingsFromSupabase(): Promise<{ ok: boolean; synced: number; error?: string; details?: string[] }> {
  if (bootstrapRan) return bootstrapResult ?? { ok: false, synced: 0, error: 'no result' };
  bootstrapRan = true;

  const details: string[] = [];

  try {
    const client = await getSupabaseClient();
    if (!client) {
      bootstrapResult = { ok: true, synced: 0, error: 'Supabase not configured' };
      return bootstrapResult;
    }

    let totalSynced = 0;

    // Helper: try-catch a single table sync, log errors but don't crash
    async function syncTable<T>(
      tableName: string,
      fetchFn: () => Promise<{ data: T[] | null; error: any }>,
      upsertFn: (row: T) => Promise<void>,
    ): Promise<void> {
      try {
        const { data, error } = await fetchFn();
        if (error) {
          if (error.message?.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
            details.push(`${tableName}: table not found (run the SQL schema)`);
          } else {
            details.push(`${tableName}: ${error.message?.slice(0, 80)}`);
          }
          return;
        }
        if (!data || data.length === 0) {
          details.push(`${tableName}: 0 rows`);
          return;
        }
        let count = 0;
        let errors = 0;
        for (const row of data) {
          try {
            await upsertFn(row);
            count++;
            totalSynced++;
          } catch (e: any) {
            // Individual row errors don't stop the whole sync
            errors++;
          }
        }
        details.push(`${tableName}: ${count} synced${errors > 0 ? `, ${errors} errors` : ''}`);
      } catch (e: any) {
        details.push(`${tableName}: ${e.message?.slice(0, 80)}`);
      }
    }

    // 1. LlmProvider — upsert by NAME (natural unique key)
    await syncTable(
      'LlmProvider',
      () => client.from('LlmProvider').select('*'),
      async (row: any) => {
        // First try to find by name, then upsert by name
        await db.llmProvider.upsert({
          where: { name: row.name },
          create: {
            id: row.id,
            name: row.name,
            baseUrl: row.baseUrl,
            apiKey: row.apiKey,
            isActive: row.isActive ?? true,
            notes: row.notes,
          },
          update: {
            baseUrl: row.baseUrl,
            apiKey: row.apiKey,
            isActive: row.isActive ?? true,
            notes: row.notes,
          },
        });
      },
    );

    // 2. LlmModel — upsert by (providerId, modelId) composite unique
    await syncTable(
      'LlmModel',
      () => client.from('LlmModel').select('*'),
      async (row: any) => {
        // Find the local provider by the Supabase provider's name to get the local providerId
        // (the Supabase providerId may differ from the local one)
        const supabaseProvider = await client.from('LlmProvider').select('name').eq('id', row.providerId).single();
        if (supabaseProvider.error || !supabaseProvider.data) {
          // Can't resolve provider — skip this model
          return;
        }
        const localProvider = await db.llmProvider.findUnique({ where: { name: supabaseProvider.data.name } });
        if (!localProvider) {
          // Provider doesn't exist locally — skip (will be created next time)
          return;
        }
        await db.llmModel.upsert({
          where: { providerId_modelId: { providerId: localProvider.id, modelId: row.modelId } },
          create: {
            id: row.id,
            providerId: localProvider.id,
            modelId: row.modelId,
            displayName: row.displayName,
            contextWindow: row.contextWindow ?? 128000,
            freeTierRpm: row.freeTierRpm ?? 10,
            isActive: row.isActive ?? true,
            capabilities: row.capabilities ?? 'text',
          },
          update: {
            displayName: row.displayName,
            contextWindow: row.contextWindow ?? 128000,
            freeTierRpm: row.freeTierRpm ?? 10,
            isActive: row.isActive ?? true,
            capabilities: row.capabilities ?? 'text',
          },
        });
      },
    );

    // 3. ModuleModelConfig — upsert by (moduleKey, layer) composite unique
    await syncTable(
      'ModuleModelConfig',
      () => client.from('ModuleModelConfig').select('*'),
      async (row: any) => {
        // Resolve the local model + provider IDs (may differ from Supabase IDs)
        const supabaseModel = await client.from('LlmModel').select('modelId, providerId').eq('id', row.modelId).single();
        const supabaseProvider = await client.from('LlmProvider').select('name').eq('id', row.providerId).single();
        if (supabaseModel.error || supabaseProvider.error || !supabaseModel.data || !supabaseProvider.data) return;

        const localProvider = await db.llmProvider.findUnique({ where: { name: supabaseProvider.data.name } });
        if (!localProvider) return;
        const localModel = await db.llmModel.findUnique({
          where: { providerId_modelId: { providerId: localProvider.id, modelId: supabaseModel.data.modelId } },
        });
        if (!localModel) return;

        await db.moduleModelConfig.upsert({
          where: { moduleKey_layer: { moduleKey: row.moduleKey, layer: row.layer } },
          create: {
            moduleKey: row.moduleKey,
            layer: row.layer,
            modelId: localModel.id,
            providerId: localProvider.id,
            temperature: row.temperature ?? 0.3,
            systemPrompt: row.systemPrompt,
            enabled: row.enabled ?? true,
          },
          update: {
            modelId: localModel.id,
            providerId: localProvider.id,
            temperature: row.temperature ?? 0.3,
            systemPrompt: row.systemPrompt,
            enabled: row.enabled ?? true,
          },
        });
      },
    );

    // 4. Asset — upsert by SYMBOL (natural unique key)
    await syncTable(
      'Asset',
      () => client.from('Asset').select('*'),
      async (row: any) => {
        await db.asset.upsert({
          where: { symbol: row.symbol },
          create: {
            id: row.id,
            symbol: row.symbol,
            name: row.name,
            assetClass: row.assetClass,
            exchange: row.exchange,
            meta: row.meta ?? '{}',
            isActive: row.isActive ?? true,
          },
          update: {
            name: row.name,
            assetClass: row.assetClass,
            exchange: row.exchange,
            meta: row.meta ?? '{}',
            isActive: row.isActive ?? true,
          },
        });
      },
    );

    // 5. Watchlist — upsert by NAME (natural unique key)
    await syncTable(
      'Watchlist',
      () => client.from('Watchlist').select('*'),
      async (row: any) => {
        await db.watchlist.upsert({
          where: { name: row.name },
          create: {
            id: row.id,
            name: row.name,
            assetClass: row.assetClass,
            symbols: row.symbols ?? '[]',
            isActive: row.isActive ?? true,
          },
          update: {
            assetClass: row.assetClass,
            symbols: row.symbols ?? '[]',
            isActive: row.isActive ?? true,
          },
        });
      },
    );

    // 6. Setting — upsert by KEY (natural unique key)
    await syncTable(
      'Setting',
      () => client.from('Setting').select('*'),
      async (row: any) => {
        await db.setting.upsert({
          where: { key: row.key },
          create: {
            key: row.key,
            value: row.value ?? '',
          },
          update: {
            value: row.value ?? '',
          },
        });
      },
    );

    // 7. ScheduleJob — upsert by MODULEKEY (natural unique key)
    await syncTable(
      'ScheduleJob',
      () => client.from('ScheduleJob').select('*'),
      async (row: any) => {
        await db.scheduleJob.upsert({
          where: { moduleKey: row.moduleKey },
          create: {
            moduleKey: row.moduleKey,
            cronExpr: row.cronExpr,
            enabled: row.enabled ?? true,
            lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
            nextRunAt: row.nextRunAt ? new Date(row.nextRunAt) : null,
            lastStatus: row.lastStatus,
            lastError: row.lastError,
          },
          update: {
            cronExpr: row.cronExpr,
            enabled: row.enabled ?? true,
          },
        });
      },
    );

    // 8. PriceAlert — upsert by ID (no natural unique key, but ID is fine since
    // these are user-created and won't conflict with seed data)
    await syncTable(
      'PriceAlert',
      () => client.from('PriceAlert').select('*'),
      async (row: any) => {
        // Check if a row with this ID exists; if not, check by assetSymbol+condition+targetPrice
        const existing = await db.priceAlert.findUnique({ where: { id: row.id } });
        if (existing) {
          await db.priceAlert.update({
            where: { id: row.id },
            data: {
              assetSymbol: row.assetSymbol,
              condition: row.condition,
              targetPrice: row.targetPrice,
              currentPrice: row.currentPrice,
              status: row.status ?? 'active',
              channel: row.channel ?? 'dashboard',
              note: row.note,
              triggeredAt: row.triggeredAt ? new Date(row.triggeredAt) : null,
            },
          });
        } else {
          await db.priceAlert.create({
            data: {
              id: row.id,
              assetSymbol: row.assetSymbol,
              condition: row.condition,
              targetPrice: row.targetPrice,
              currentPrice: row.currentPrice,
              status: row.status ?? 'active',
              channel: row.channel ?? 'dashboard',
              note: row.note,
              triggeredAt: row.triggeredAt ? new Date(row.triggeredAt) : null,
            },
          });
        }
      },
    );

    // 9. PortfolioHolding — upsert by ID (same as PriceAlert)
    await syncTable(
      'PortfolioHolding',
      () => client.from('PortfolioHolding').select('*'),
      async (row: any) => {
        const existing = await db.portfolioHolding.findUnique({ where: { id: row.id } });
        if (existing) {
          await db.portfolioHolding.update({
            where: { id: row.id },
            data: {
              assetSymbol: row.assetSymbol,
              quantity: row.quantity,
              entryPrice: row.entryPrice,
              entryDate: row.entryDate ? new Date(row.entryDate) : new Date(),
              notes: row.notes,
            },
          });
        } else {
          await db.portfolioHolding.create({
            data: {
              id: row.id,
              assetSymbol: row.assetSymbol,
              quantity: row.quantity,
              entryPrice: row.entryPrice,
              entryDate: row.entryDate ? new Date(row.entryDate) : new Date(),
              notes: row.notes,
            },
          });
        }
      },
    );

    console.log(`[bootstrap] Synced ${totalSynced} rows from Supabase to local SQLite`);
    bootstrapResult = { ok: true, synced: totalSynced, details };
    return bootstrapResult;
  } catch (e: any) {
    console.error('[bootstrap] Supabase sync failed:', e.message);
    bootstrapResult = { ok: false, synced: 0, error: e.message, details };
    return bootstrapResult;
  }
}

/**
 * Push all local SQLite settings to Supabase. Called when the user saves a
 * setting locally and wants it synced to the cloud.
 */
export async function pushSettingsToSupabase(): Promise<{ ok: boolean; pushed: number; error?: string }> {
  try {
    const client = await getSupabaseClient();
    if (!client) {
      return { ok: false, pushed: 0, error: 'Supabase not configured' };
    }

    const rows = await db.setting.findMany();
    let pushed = 0;
    for (const row of rows) {
      try {
        await client.from('Setting').upsert({
          key: row.key,
          value: row.value,
        }, { onConflict: 'key' });
        pushed++;
      } catch (e: any) {
        console.error(`[sync] Failed to push setting '${row.key}':`, e.message);
      }
    }

    return { ok: true, pushed };
  } catch (e: any) {
    return { ok: false, pushed: 0, error: e.message };
  }
}
