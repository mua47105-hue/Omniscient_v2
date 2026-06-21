import { NextResponse } from 'next/server';
import { SUPABASE_SCHEMA_SQL, SUPABASE_TABLES } from '@/lib/supabase/schema-sql';
import { getSupabaseConfig } from '@/lib/supabase/client';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supabase/schema
 * Returns the SQL schema string + the list of tables + whether credentials are configured.
 * The dashboard renders this so the user can copy-paste the SQL into Supabase SQL Editor.
 */
export async function GET() {
  const config = await getSupabaseConfig();
  return NextResponse.json<ApiResult<{
    sql: string;
    tables: readonly string[];
    configured: boolean;
  }>>({
    success: true,
    data: {
      sql: SUPABASE_SCHEMA_SQL,
      tables: SUPABASE_TABLES,
      configured: !!config,
    },
  });
}
