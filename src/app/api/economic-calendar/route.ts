/**
 * Economic calendar API.
 *
 * GET /api/economic-calendar?days=14
 *
 * Tries finnhub first (free tier — calendar/economic). If no API key or
 * request fails, falls back to a curated mock list of upcoming high-impact
 * economic events (CPI, FOMC, NFP, etc.) so the UI is always populated.
 */
import { NextResponse } from 'next/server';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

interface EconEvent {
  id: string;
  country: string;
  event: string;
  date: string; // ISO
  impact: 'low' | 'medium' | 'high';
  actual?: string | null;
  estimate?: string | null;
  previous?: string | null;
  source: 'finnhub' | 'mock';
}

// ---------------------------------------------------------------------------
// Mock events — generate upcoming high-impact releases based on today's date
// ---------------------------------------------------------------------------

function mockEvents(days: number): EconEvent[] {
  const now = new Date();
  const events: EconEvent[] = [];
  // Build a stable list anchored on the next 14 days.
  const templates: Array<{
    country: string;
    event: string;
    impact: 'low' | 'medium' | 'high';
    estimate?: string;
    previous?: string;
    dayOffset: number;
    hour: number;
  }> = [
    { country: 'US', event: 'CPI (YoY)', impact: 'high', estimate: '3.1%', previous: '3.2%', dayOffset: 2, hour: 13 },
    { country: 'US', event: 'CPI (MoM)', impact: 'high', estimate: '0.3%', previous: '0.4%', dayOffset: 2, hour: 13 },
    { country: 'US', event: 'Core CPI (YoY)', impact: 'high', estimate: '3.7%', previous: '3.8%', dayOffset: 2, hour: 13 },
    { country: 'US', event: 'FOMC Rate Decision', impact: 'high', estimate: '5.50%', previous: '5.50%', dayOffset: 5, hour: 18 },
    { country: 'US', event: 'FOMC Statement', impact: 'high', dayOffset: 5, hour: 18 },
    { country: 'US', event: 'Nonfarm Payrolls', impact: 'high', estimate: '180K', previous: '199K', dayOffset: 7, hour: 13 },
    { country: 'US', event: 'Unemployment Rate', impact: 'high', estimate: '3.8%', previous: '3.7%', dayOffset: 7, hour: 13 },
    { country: 'US', event: 'Initial Jobless Claims', impact: 'medium', estimate: '215K', previous: '218K', dayOffset: 3, hour: 13 },
    { country: 'US', event: 'Retail Sales (MoM)', impact: 'medium', estimate: '0.4%', previous: '0.3%', dayOffset: 9, hour: 13 },
    { country: 'US', event: 'PCE Price Index (YoY)', impact: 'high', estimate: '2.6%', previous: '2.6%', dayOffset: 11, hour: 13 },
    { country: 'US', event: 'Core PCE (YoM)', impact: 'high', estimate: '2.9%', previous: '3.2%', dayOffset: 11, hour: 13 },
    { country: 'US', event: 'GDP (QoQ Annualized)', impact: 'medium', estimate: '4.9%', previous: '4.9%', dayOffset: 13, hour: 13 },
    { country: 'EU', event: 'ECB Rate Decision', impact: 'high', estimate: '4.50%', previous: '4.50%', dayOffset: 4, hour: 13 },
    { country: 'UK', event: 'BOE Rate Decision', impact: 'high', estimate: '5.25%', previous: '5.25%', dayOffset: 6, hour: 12 },
    { country: 'JP', event: 'BOJ Rate Decision', impact: 'medium', estimate: '-0.10%', previous: '-0.10%', dayOffset: 8, hour: 3 },
  ];

  for (const t of templates) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + t.dayOffset);
    d.setUTCHours(t.hour, 0, 0, 0);
    if (t.dayOffset > days) continue;
    events.push({
      id: `mock-${t.country}-${t.event}-${d.toISOString()}`,
      country: t.country,
      event: t.event,
      date: d.toISOString(),
      impact: t.impact,
      estimate: t.estimate ?? null,
      previous: t.previous ?? null,
      actual: null,
      source: 'mock',
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

// ---------------------------------------------------------------------------
// finnhub fetch
// ---------------------------------------------------------------------------

async function finnhubEvents(days: number): Promise<EconEvent[] | null> {
  const apiKey = await getSetting<string>(SETTING_KEYS.finnhubApiKey);
  if (!apiKey) return null;

  const today = new Date();
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() + days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${fmt(today)}&to=${fmt(end)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const rawEvents = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
    return rawEvents.map((e: any, i: number): EconEvent => {
      const impact = ['low', 'medium', 'high'].includes(e.impact) ? e.impact : 'medium';
      return {
        id: `finnhub-${i}-${e.country ?? '??'}-${e.event ?? 'event'}`,
        country: e.country ?? '—',
        event: e.event ?? 'Economic event',
        date: e.time ?? new Date().toISOString(),
        impact: impact as EconEvent['impact'],
        actual: e.actual ?? null,
        estimate: e.estimate ?? null,
        previous: e.prev ?? null,
        source: 'finnhub',
      };
    });
  } catch (err) {
    console.error('[economic-calendar] finnhub fetch failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(60, parseInt(searchParams.get('days') ?? '14', 10) || 14));

    const finnhub = await finnhubEvents(days);
    const events = finnhub && finnhub.length > 0 ? finnhub : mockEvents(days);

    return NextResponse.json({
      success: true,
      data: events,
      source: finnhub && finnhub.length > 0 ? 'finnhub' : 'mock',
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
