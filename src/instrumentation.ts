// Next.js instrumentation hook — runs once when the server starts.
//
// This is the official Next.js way to run code at server startup (see
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// It runs in the Node.js server process before any request is handled.
//
// We use it to:
//   1. Pull ALL data from Supabase into local SQLite (bootstrap sync).
//      This restores providers, models, assets, watchlists, settings, etc.
//      after a HF Space restart/rebuild wipes the ephemeral filesystem.
//   2. If Supabase was empty (first boot), PUSH all local seeded data TO
//      Supabase so future restarts can restore it.
//   3. Start a periodic auto-sync (every 5 min) that pushes local changes
//      to Supabase — so user-added portfolio holdings, API keys, etc. are
//      saved to the cloud automatically.
//   4. Log the runtime environment for debugging.

export async function register() {
  // Only run in the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const startTime = Date.now();
  console.log('[instrumentation] Server starting...');

  // Log runtime environment
  try {
    const { IS_HF_SPACE, HF_SPACE_ID, getDatabaseUrl, hasHfSecrets } = await import('@/lib/runtime');
    console.log(`[instrumentation] Environment: ${IS_HF_SPACE ? 'Hugging Face Spaces' : 'local/dev'}`);
    if (IS_HF_SPACE && HF_SPACE_ID) {
      console.log(`[instrumentation] Space ID: ${HF_SPACE_ID}`);
    }
    console.log(`[instrumentation] Database URL: ${getDatabaseUrl()}`);
    console.log(`[instrumentation] HF Secrets configured: ${hasHfSecrets() ? 'yes' : 'no'}`);
  } catch (e: any) {
    console.error('[instrumentation] Failed to log runtime:', e.message);
  }

  // Bootstrap: pull ALL data from Supabase into local SQLite
  let bootstrapSynced = 0;
  try {
    const { bootstrapSettingsFromSupabase } = await import('@/lib/sync/bootstrap');
    const result = await bootstrapSettingsFromSupabase();
    bootstrapSynced = result.synced;
    if (result.ok && result.synced > 0) {
      console.log(`[instrumentation] Bootstrap sync: ${result.synced} rows restored from Supabase`);
      if (result.details) {
        for (const d of result.details) {
          console.log(`[instrumentation]   ${d}`);
        }
      }
    } else if (result.ok && result.synced === 0) {
      console.log(`[instrumentation] Bootstrap sync: Supabase empty or not configured (${result.error ?? 'no data'})`);
    } else {
      console.error(`[instrumentation] Bootstrap sync failed: ${result.error}`);
    }
  } catch (e: any) {
    console.error('[instrumentation] Bootstrap sync error (non-fatal):', e.message);
  }

  // If bootstrap pulled 0 rows (Supabase was empty), push local data TO Supabase
  // so future restarts can restore it. This is the "initial sync" — it populates
  // Supabase with the seeded providers, assets, watchlists, settings, etc.
  if (bootstrapSynced === 0) {
    try {
      const { getSupabaseConfig } = await import('@/lib/supabase/client');
      const config = await getSupabaseConfig();
      if (config) {
        console.log('[instrumentation] Supabase is empty — pushing local data to Supabase (initial sync)...');
        const { syncToSupabase } = await import('@/lib/supabase/sync');
        const syncResult = await syncToSupabase();
        if (syncResult.totalSynced > 0) {
          console.log(`[instrumentation] Initial sync: pushed ${syncResult.totalSynced} rows to Supabase`);
        } else {
          console.log('[instrumentation] Initial sync: nothing to push');
        }
      }
    } catch (e: any) {
      console.error('[instrumentation] Initial sync error (non-fatal):', e.message);
    }
  }

  // Start periodic auto-sync: every 5 minutes, push local SQLite → Supabase.
  // This ensures user-added portfolio holdings, API keys, settings, etc. are
  // saved to the cloud automatically, so they survive Space restarts.
  try {
    const { getSupabaseConfig } = await import('@/lib/supabase/client');
    const config = await getSupabaseConfig();
    if (config) {
      console.log('[instrumentation] Starting periodic auto-sync (every 5 min)');
      const { syncToSupabase } = await import('@/lib/supabase/sync');
      // Use globalThis so the interval survives module hot-reloads in dev
      const g = globalThis as unknown as { __supabaseAutoSyncInterval?: NodeJS.Timeout };
      if (g.__supabaseAutoSyncInterval) clearInterval(g.__supabaseAutoSyncInterval);
      g.__supabaseAutoSyncInterval = setInterval(async () => {
        try {
          const result = await syncToSupabase();
          if (result.totalSynced > 0) {
            console.log(`[auto-sync] Pushed ${result.totalSynced} rows to Supabase (${result.durationMs}ms)`);
          }
        } catch (e: any) {
          console.error('[auto-sync] Failed:', e.message);
        }
      }, 5 * 60 * 1000); // 5 minutes
    }
  } catch (e: any) {
    console.error('[instrumentation] Auto-sync setup error (non-fatal):', e.message);
  }

  console.log(`[instrumentation] Startup complete in ${Date.now() - startTime}ms`);
}
