// POST /api/supabase/sync — triggers a full SQLite → Supabase sync.
// Pushes all 16 tables to Supabase in dependency order.
import { NextResponse } from 'next/server';
import { syncToSupabase } from '@/lib/supabase/sync';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // 2 minutes — syncing 1000+ rows takes time

export async function POST() {
  try {
    const result = await syncToSupabase();
    return NextResponse.json<ApiResult<typeof result>>({
      success: true,
      data: result,
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}
