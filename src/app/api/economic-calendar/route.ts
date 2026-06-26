// Economic calendar — tiered: Finnhub API (if user key configured) → clear
// "not available" message when no key is set.
//
// Previously used z-ai-web-dev-sdk for web search fallback, but ZAI is not
// reachable on Hugging Face Spaces (no .z-ai-config file, and the SDK
// requires a config that doesn't exist in that environment). Removed ZAI
// dependency entirely — the route now works with Finnhub only, and returns
// a clear message when no Finnhub key is configured.
//
// To enable: set FINNHUB_API_KEY in HF Space Secrets or Settings → Data Sources.

import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 300; // 5 min cache

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EconomicEvent {
  date: string;       // ISO date YYYY-MM-DD
  time?: string;      // HH:mm (UTC) or "All Day"
  country: string;    // "US", "EU", "IN", etc.
  event: string;      // "Fed Rate Decision", "CPI", etc.
  impact: 'high' | 'medium' | 'low';
  forecast?: string;
  previous?: string;
  source: string;
  url?: string;
}

interface CalendarResponse {
  events: EconomicEvent[];
  source: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapFinnhubImpact(impact: any): 'high' | 'medium' | 'low' {
  const n = typeof impact === 'string' ? parseInt(impact) : impact;
  if (n === 3) return 'high';
  if (n === 2) return 'medium';
  return 'low';
}

function nativeHttpsGet(url: string, timeoutMs = 15000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'OMNISCIENT/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// ---------------------------------------------------------------------------
// Source 1: Finnhub (requires user API key — free tier: 60 calls/min)
// ---------------------------------------------------------------------------

async function fetchFinnhub(apiKey: string, fromISO: string, toISO: string): Promise<EconomicEvent[]> {
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${fromISO}&to=${toISO}&token=${apiKey}`;
  const { status, text } = await nativeHttpsGet(url);
  if (status !== 200) throw new Error(`Finnhub ${status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const rawEvents: any[] = data?.economicCalendar ?? data?.events ?? [];
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) return [];

  return rawEvents.map((e: any) => ({
    date: e.date || fromISO,
    time: e.time || 'All Day',
    country: String(e.country || '').toUpperCase().slice(0, 2) || 'US',
    event: String(e.event || e.name || 'Economic Event').slice(0, 200),
    impact: mapFinnhubImpact(e.impact),
    forecast: e.forecast != null && e.forecast !== '' ? String(e.forecast) : undefined,
    previous: e.prev != null && e.prev !== '' ? String(e.prev) : undefined,
    source: 'Finnhub',
  }));
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  const now = new Date();
  const to = new Date(now);
  to.setDate(to.getDate() + 14);
  const fromISO = fmtDate(now);
  const toISO = fmtDate(to);

  // Try Finnhub (requires user API key)
  const finnhubKey = await getSetting<string>(SETTING_KEYS.finnhubApiKey, '');
  if (finnhubKey && typeof finnhubKey === 'string' && finnhubKey.trim().length > 5 && !finnhubKey.startsWith('PASTE_')) {
    try {
      const events = await fetchFinnhub(finnhubKey.trim(), fromISO, toISO);
      if (events.length > 0) {
        return NextResponse.json<ApiResult<CalendarResponse>>({
          success: true,
          data: { events, source: 'finnhub' },
        });
      }
      // Empty finnhub → fall through to "not available"
    } catch (e: any) {
      console.warn('[economic-calendar] Finnhub failed:', e?.message);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Finnhub API error: ${e?.message || 'unknown'}` },
        { status: 502 }
      );
    }
  }

  // No Finnhub key configured — return clear "not available" message
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: 'Economic calendar requires a Finnhub API key. Go to Settings → Data Sources → paste your Finnhub key. Free tier: finnhub.io/register',
    },
    { status: 200 } // 200 not 4xx — the UI should show a helpful message, not an error toast
  );
}
