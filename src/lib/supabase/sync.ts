/**
 * Supabase cloud sync — optional, best-effort.
 *
 * Stub implementation: returns null. If a real Supabase client + sync logic
 * is added later (per the PROJECT_HANDOVER roadmap), replace this file with
 * the real implementation that mirrors local Signal/SignalOutcome/Asset rows
 * to the Supabase Postgres instance. The scheduler tick calls this on every
 * run inside a try/catch — a no-op here is safe.
 *
 * The function signature is intentionally permissive so the tick handler can
 * call it without knowing whether Supabase is configured.
 */
export interface SupabaseSyncResult {
  synced: boolean;
  reason: string;
  rowsSynced?: number;
}

export async function syncToSupabase(): Promise<SupabaseSyncResult | null> {
  // No Supabase configuration present — return null so the tick handler
  // records sync: null and moves on. Real implementation would check
  // process.env.SUPABASE_URL + SUPABASE_ANON_KEY and push recent rows.
  return null;
}
