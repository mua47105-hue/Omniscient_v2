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
// This module handles layer 2: it runs once on startup (via instrumentation.ts)
// and pulls ALL tables from Supabase into the local DB. It's idempotent —
// running it multiple times is safe (uses upsert).
//
// Tables are pulled in dependency order (parents before children) to respect
// foreign key constraints.

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

    // Pull tables in dependency order (parents first, children after)

    // 1. LlmProvider (parent — no dependencies)
    try {
      const { data, error } = await client.from('LlmProvider').select('*');
      if (error) {
        if (error.message.includes('does not exist') || error.code === '42P01' || error.code === 'PGRST205') {
          details.push('LlmProvider: table not found (run the SQL schema)');
        } else {
          details.push(`LlmProvider: ${error.message}`);
        }
      } else if (data && data.length > 0) {
        for (const row of data) {
          await db.llmProvider.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              name: row.name,
              baseUrl: row.baseUrl,
              apiKey: row.apiKey,
              isActive: row.isActive ?? true,
              notes: row.notes,
            },
            update: {
              name: row.name,
              baseUrl: row.baseUrl,
              apiKey: row.apiKey,
              isActive: row.isActive ?? true,
              notes: row.notes,
            },
          });
          totalSynced++;
        }
        details.push(`LlmProvider: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`LlmProvider: ${e.message}`);
    }

    // 2. LlmModel (depends on LlmProvider)
    try {
      const { data, error } = await client.from('LlmModel').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.llmModel.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              providerId: row.providerId,
              modelId: row.modelId,
              displayName: row.displayName,
              contextWindow: row.contextWindow ?? 128000,
              freeTierRpm: row.freeTierRpm ?? 10,
              isActive: row.isActive ?? true,
              capabilities: row.capabilities ?? 'text',
            },
            update: {
              providerId: row.providerId,
              modelId: row.modelId,
              displayName: row.displayName,
              contextWindow: row.contextWindow ?? 128000,
              freeTierRpm: row.freeTierRpm ?? 10,
              isActive: row.isActive ?? true,
              capabilities: row.capabilities ?? 'text',
            },
          });
          totalSynced++;
        }
        details.push(`LlmModel: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`LlmModel: ${e.message}`);
    }

    // 3. ModuleModelConfig (depends on LlmModel + LlmProvider)
    try {
      const { data, error } = await client.from('ModuleModelConfig').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.moduleModelConfig.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              moduleKey: row.moduleKey,
              layer: row.layer,
              modelId: row.modelId,
              providerId: row.providerId,
              temperature: row.temperature ?? 0.3,
              systemPrompt: row.systemPrompt,
              enabled: row.enabled ?? true,
            },
            update: {
              moduleKey: row.moduleKey,
              layer: row.layer,
              modelId: row.modelId,
              providerId: row.providerId,
              temperature: row.temperature ?? 0.3,
              systemPrompt: row.systemPrompt,
              enabled: row.enabled ?? true,
            },
          });
          totalSynced++;
        }
        details.push(`ModuleModelConfig: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`ModuleModelConfig: ${e.message}`);
    }

    // 4. Asset (parent — no dependencies)
    try {
      const { data, error } = await client.from('Asset').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.asset.upsert({
            where: { id: row.id },
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
              symbol: row.symbol,
              name: row.name,
              assetClass: row.assetClass,
              exchange: row.exchange,
              meta: row.meta ?? '{}',
              isActive: row.isActive ?? true,
            },
          });
          totalSynced++;
        }
        details.push(`Asset: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`Asset: ${e.message}`);
    }

    // 5. Watchlist
    try {
      const { data, error } = await client.from('Watchlist').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.watchlist.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              name: row.name,
              assetClass: row.assetClass,
              symbols: row.symbols ?? '[]',
              isActive: row.isActive ?? true,
            },
            update: {
              name: row.name,
              assetClass: row.assetClass,
              symbols: row.symbols ?? '[]',
              isActive: row.isActive ?? true,
            },
          });
          totalSynced++;
        }
        details.push(`Watchlist: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`Watchlist: ${e.message}`);
    }

    // 6. Setting (global KV — most important for credentials)
    try {
      const { data, error } = await client.from('Setting').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
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
          totalSynced++;
        }
        details.push(`Setting: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`Setting: ${e.message}`);
    }

    // 7. ScheduleJob
    try {
      const { data, error } = await client.from('ScheduleJob').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.scheduleJob.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              moduleKey: row.moduleKey,
              cronExpr: row.cronExpr,
              enabled: row.enabled ?? true,
              lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
              nextRunAt: row.nextRunAt ? new Date(row.nextRunAt) : null,
              lastStatus: row.lastStatus,
              lastError: row.lastError,
            },
            update: {
              moduleKey: row.moduleKey,
              cronExpr: row.cronExpr,
              enabled: row.enabled ?? true,
            },
          });
          totalSynced++;
        }
        details.push(`ScheduleJob: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`ScheduleJob: ${e.message}`);
    }

    // 8. PriceAlert
    try {
      const { data, error } = await client.from('PriceAlert').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.priceAlert.upsert({
            where: { id: row.id },
            create: {
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
            update: {
              assetSymbol: row.assetSymbol,
              condition: row.condition,
              targetPrice: row.targetPrice,
              status: row.status ?? 'active',
            },
          });
          totalSynced++;
        }
        details.push(`PriceAlert: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`PriceAlert: ${e.message}`);
    }

    // 9. PortfolioHolding
    try {
      const { data, error } = await client.from('PortfolioHolding').select('*');
      if (!error && data && data.length > 0) {
        for (const row of data) {
          await db.portfolioHolding.upsert({
            where: { id: row.id },
            create: {
              id: row.id,
              assetSymbol: row.assetSymbol,
              quantity: row.quantity,
              entryPrice: row.entryPrice,
              entryDate: row.entryDate ? new Date(row.entryDate) : new Date(),
              notes: row.notes,
            },
            update: {
              assetSymbol: row.assetSymbol,
              quantity: row.quantity,
              entryPrice: row.entryPrice,
            },
          });
          totalSynced++;
        }
        details.push(`PortfolioHolding: ${data.length} rows`);
      }
    } catch (e: any) {
      details.push(`PortfolioHolding: ${e.message}`);
    }

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
