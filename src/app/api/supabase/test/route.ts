// Supabase connection test endpoint.
//
// WHY THIS EXISTS:
// The Settings → Supabase page has a "Test Connection" button that POSTs the
import { validateBody, schemas } from "@/lib/api/validation";
// user's Supabase URL + anon key here. Without this route, the request fell
// through to Next.js's 404 HTML page, the frontend's JSON.parse(text) failed,
// and the user saw "Server error — check if DATABASE_URL is configured" — a
// complete red herring (their credentials were fine, the endpoint just didn't
// exist).
//
// This route delegates to the existing testSupabaseConnection() helper in
// lib/supabase/client.ts, which:
//   1. Creates a Supabase client with the provided (or saved) credentials
//   2. Runs a trivial SELECT against the Setting table
//   3. Returns { ok, error?, tableExists? } so the UI can distinguish
//      "connected + tables exist" vs "connected + run the schema SQL" vs
//      "connection failed".

import { NextRequest, NextResponse } from 'next/server';
import { testSupabaseConnection } from '@/lib/supabase/client';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 15; // connection test should never take >15s

interface TestBody {
  url?: string;
  anonKey?: string;
}

interface TestResultData {
  ok: boolean;
  error?: string;
  tableExists?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req, schemas.supabaseTest) as any;

    // If the user provided URL + anon key in the request body, test those
    // (this is the "Test" button flow — tests before/after saving).
    // If not provided, testSupabaseConnection falls back to the saved
    // credentials from the Setting table.
    const url = body.url?.trim();
    const anonKey = body.anonKey?.trim();

    // Basic validation when credentials are provided in the body
    if (url !== undefined || anonKey !== undefined) {
      if (!url || !anonKey) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Both Project URL and anon key are required.' },
          { status: 400 }
        );
      }
      if (!url.startsWith('https://')) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Project URL must start with https://' },
          { status: 400 }
        );
      }
      if (!url.includes('.supabase.co')) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Project URL should be a Supabase URL (https://<project>.supabase.co)' },
          { status: 400 }
        );
      }
    }

    const result = await testSupabaseConnection(url, anonKey);
    const data: TestResultData = {
      ok: result.ok,
      error: result.error,
      tableExists: result.tableExists,
    };
    return NextResponse.json<ApiResult<TestResultData>>({ success: true, data });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: (e?.message || String(e)).slice(0, 300) },
      { status: 500 }
    );
  }
}
