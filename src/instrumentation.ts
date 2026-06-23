// Next.js instrumentation hook — runs once when the server starts.
//
// This is the official Next.js way to run code at server startup (see
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
// It runs in the Node.js server process before any request is handled.
//
// We use it to:
//   1. Pull settings from Supabase into local SQLite (bootstrap sync).
//      This restores user settings (watchlists, alert thresholds, module
//      configs, API keys stored in DB) after a HF Space restart/rebuild
//      wipes the ephemeral filesystem.
//   2. Log the runtime environment (HF Space detection, DB path, persistence
//      layer status) so deployment issues are diagnosable.
//
// IMPORTANT: This must be non-blocking and fail-safe. If Supabase is down or
// unconfigured, the app should still start — it just falls back to the
// DB/env-var/seed defaults.

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

  // Bootstrap: pull settings from Supabase into local SQLite
  try {
    const { bootstrapSettingsFromSupabase } = await import('@/lib/sync/bootstrap');
    const result = await bootstrapSettingsFromSupabase();
    if (result.ok && result.synced > 0) {
      console.log(`[instrumentation] Bootstrap sync: ${result.synced} settings restored from Supabase`);
    } else if (result.ok && result.synced === 0) {
      console.log(`[instrumentation] Bootstrap sync skipped: ${result.error ?? 'no settings to sync'}`);
    } else {
      console.error(`[instrumentation] Bootstrap sync failed: ${result.error}`);
    }
  } catch (e: any) {
    console.error('[instrumentation] Bootstrap sync error (non-fatal):', e.message);
  }

  console.log(`[instrumentation] Startup complete in ${Date.now() - startTime}ms`);
}
