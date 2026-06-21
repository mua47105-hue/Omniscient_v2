// Reddit social sentiment — free, no key, pure word-count (zero LLM tokens).
// GET /api/sentiment/reddit         → aggregate across r/cryptocurrency, r/bitcoin, r/ethtrader
// GET /api/sentiment/reddit?sub=xxx → single subreddit
//
// NOTE: Reddit blocks datacenter IPs (403). On such hosts this returns a
// graceful { available: false } state instead of erroring, so the UI can show
// "unavailable" cleanly. The source works on residential/HF-Spaces hosts.
import { NextRequest, NextResponse } from 'next/server';
import { getCryptoSocialSentiment, getRedditSentiment } from '@/lib/market/reddit';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sub = req.nextUrl.searchParams.get('sub');
    if (sub) {
      const data = await getRedditSentiment(sub, 25);
      return NextResponse.json<ApiResult<typeof data & { available: boolean }>>({ success: true, data: { ...data, available: true } });
    }
    const data = await getCryptoSocialSentiment();
    return NextResponse.json<ApiResult<typeof data & { available: boolean }>>({ success: true, data: { ...data, available: true } });
  } catch {
    // Graceful degradation — Reddit is often IP-blocked on datacenter hosts.
    return NextResponse.json<ApiResult<{ available: false; reason: string }>>({
      success: true,
      data: { available: false, reason: 'Reddit is unreachable from this host (likely IP-blocked). Works on residential/HF-Spaces hosts.' },
    });
  }
}
