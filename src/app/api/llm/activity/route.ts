// LLM Activity endpoint — returns recent LLM calls + summary stats.
// Used by the /llm-activity page to show what each model is doing in real-time.
import { NextResponse } from 'next/server';
import { getLlmActivity, getLlmActivityStats } from '@/lib/llm/activity';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const entries = getLlmActivity(50);
  const stats = getLlmActivityStats();
  return NextResponse.json<ApiResult<{ entries: typeof entries; stats: typeof stats }>>({
    success: true,
    data: { entries, stats },
  });
}
