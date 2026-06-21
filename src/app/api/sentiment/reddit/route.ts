/**
 * Reddit sentiment API.
 *
 * GET /api/sentiment/reddit?sub=CryptoCurrency
 *
 *   - With ?sub=xxx → calls getRedditSentiment (single sub).
 *   - Without ?sub  → calls getCryptoSocialSentiment (3-sub aggregate).
 *
 * Reddit's JSON API 403s datacenter IPs aggressively — this route degrades
 * gracefully and returns {available: false} on any failure so the UI can
 * render a "Reddit unavailable" tile instead of crashing.
 */
import { NextResponse } from 'next/server';
import {
  getRedditSentiment,
  getCryptoSocialSentiment,
} from '@/lib/market/reddit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sub = searchParams.get('sub')?.trim();

    if (sub) {
      // Single sub — getRedditSentiment already degrades gracefully.
      const result = await getRedditSentiment(sub);
      return NextResponse.json({ success: true, data: result });
    }

    // Aggregate across the 3 main crypto subs.
    const result = await getCryptoSocialSentiment();
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    // Defensive: the underlying modules already return available=false on
    // network errors, but if something blows up at the route layer we still
    // return a 200 with {success:false, available:false} so the UI degrades.
    return NextResponse.json(
      {
        success: false,
        available: false,
        error: (err as Error).message,
      },
      { status: 200 },
    );
  }
}
