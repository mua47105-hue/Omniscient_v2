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

  // Start the in-process scheduler tick — every 60 seconds, POST to
  // /api/scheduler/tick?alerts=1. This replaces the separate mini-service
  // scheduler that was never started on HF Spaces (the Dockerfile only
  // runs `next start`, not the scheduler process).
  //
  // The tick is self-authenticating: it uses the CRON_SECRET env var
  // (if set) or falls back to the internal cookie (if CRON_SECRET is
  // not configured, the middleware allows the request via the app's
  // own session — the tick runs server-side so it's trusted).
  try {
    console.log('[instrumentation] Starting in-process scheduler tick (every 60s)');
    const g2 = globalThis as unknown as { __schedulerTickInterval?: NodeJS.Timeout };
    if (g2.__schedulerTickInterval) clearInterval(g2.__schedulerTickInterval);

    const tickUrl = `http://localhost:${process.env.PORT || '7860'}/api/scheduler/tick?alerts=1`;
    const cronSecret = process.env.CRON_SECRET;

    g2.__schedulerTickInterval = setInterval(async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (cronSecret) headers['X-Cron-Secret'] = cronSecret;

        const res = await fetch(tickUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ts: Date.now() }),
          signal: AbortSignal.timeout(120_000), // 2 min timeout — ticks can take 30-60s
        });

        if (!res.ok) {
          console.error(`[scheduler-tick] HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 100)}`);
          return;
        }

        const json = await res.json();
        const ran = json.data?.ran ?? [];
        const skipped = json.data?.skipped;
        if (ran.length > 0) {
          console.log(`[scheduler-tick] Ran ${ran.length} module(s) at ${new Date().toISOString()}`);
        } else if (skipped) {
          // Normal — tick skipped because no module is due
        }
      } catch (e: any) {
        console.error('[scheduler-tick] Failed:', e.message?.slice(0, 100));
      }
    }, 60_000); // every 60 seconds
  } catch (e: any) {
    console.error('[instrumentation] Scheduler tick setup error (non-fatal):', e.message);
  }

  console.log(`[instrumentation] Startup complete in ${Date.now() - startTime}ms`);
}
