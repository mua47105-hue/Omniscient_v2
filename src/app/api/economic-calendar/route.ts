// Economic calendar — tiered: Finnhub API (if user key configured) → z-ai web search fallback.
import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface EconomicEvent {
  date: string;        // ISO date (YYYY-MM-DD)
  time?: string;       // e.g. "8:30 AM ET"
  country: string;     // "US", "EU", "IN", etc.
  event: string;       // "CPI m/m", "Non-Farm Payrolls"
  impact: 'high' | 'medium' | 'low';
  actual?: string;
  forecast?: string;
  previous?: string;
  source?: string;
  url?: string;
}

interface CalendarResponse {
  events: EconomicEvent[];
  source: 'finnhub' | 'web-search';
}

// ---------- Helpers ----------

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Map Finnhub impact (numeric/string) → high/medium/low
function mapFinnhubImpact(impact: any): 'high' | 'medium' | 'low' {
  const v = Number(impact);
  if (!Number.isNaN(v)) {
    if (v >= 3) return 'high';
    if (v === 2) return 'medium';
    return 'low';
  }
  const s = String(impact || '').toLowerCase();
  if (s.includes('high') || s.includes('red') || s === '3') return 'high';
  if (s.includes('med') || s.includes('orange') || s === '2') return 'medium';
  return 'low';
}

// Detect impact from event name keywords (used by web-search fallback)
function inferImpactFromName(name: string): 'high' | 'medium' | 'low' {
  const n = name.toLowerCase();
  const highKw = [
    'cpi', 'nonfarm', 'non-farm', 'non farm', 'nfp', 'fed rate', 'fomc',
    'interest rate', 'rate decision', 'policy rate', 'gdp', 'ecb rate',
    'boe rate', 'boj rate', 'rbca rate', 'rba rate', 'unemployment rate',
    'core cpi', 'core pce', 'pce price', 'ppr decision', 'central bank',
    'press conference', 'fed chair', 'ecb president',
  ];
  const medKw = [
    'retail sales', 'pmi', 'ism', 'jobless claims', 'unemployment',
    'ppi', 'trade balance', 'industrial production', 'consumer confidence',
    'housing starts', 'building permits', 'durable goods', 'zew', 'ifo',
  ];
  if (highKw.some((k) => n.includes(k))) return 'high';
  if (medKw.some((k) => n.includes(k))) return 'medium';
  return 'low';
}

// Detect country from event/source text (web-search fallback)
function inferCountry(text: string): string {
  const t = text.toLowerCase();
  if (/(united states|\bus\b|u\.s\.|america|fed|fomc|nfp|nonfarm|wall street)/.test(t)) return 'US';
  if (/(eurozone|euro area|\beu\b|ecb|germany|france|italy|spain|iem|eu area)/.test(t)) return 'EU';
  if (/(india|\bin\b|nse|bse|rbi|reserve bank of india|inr|rupee)/.test(t)) return 'IN';
  if (/(united kingdom|\buk\b|u\.k\.|britain|boe|bank of england|gbp|pound sterling)/.test(t)) return 'UK';
  if (/(japan|\bjp\b|boj|bank of japan|yen|jpy|nikkei)/.test(t)) return 'JP';
  if (/(china|prc|pboc|yuan|renminbi|\bcny\b)/.test(t)) return 'CN';
  if (/(canada|canadian|boc|bank of canada|cad|loonie)/.test(t)) return 'CA';
  if (/(australia|australian|rba|aud)/.test(t)) return 'AU';
  if (/(switzerland|swiss|snb|chf)/.test(t)) return 'CH';
  return 'US';
}

// Pull an ISO date out of a free-form snippet/title
function extractDate(text: string, fallbackISO: string): string {
  if (!text) return fallbackISO;
  // Look for "Mon, DD" or "Month DD, YYYY" or "DD Month YYYY" or "YYYY-MM-DD"
  const monthMap: Record<string, number> = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
    september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const now = new Date();
  const year = now.getFullYear();

  // "2025-06-18" or "06/18/2025"
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const m = String(us[1]).padStart(2, '0');
    const d = String(us[2]).padStart(2, '0');
    return `${us[3]}-${m}-${d}`;
  }
  // "June 18" / "Jun 18" / "June 18, 2025"
  const m1 = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (m1) {
    const mo = monthMap[m1[1].toLowerCase()];
    const d = String(Number(m1[2])).padStart(2, '0');
    const y = m1[3] ? m1[3] : year;
    if (mo) return `${y}-${String(mo).padStart(2, '0')}-${d}`;
  }
  // "18 June 2025" / "18 Jun"
  const m2 = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:,?\s*(\d{4}))?/i);
  if (m2) {
    const mo = monthMap[m2[2].toLowerCase()];
    const d = String(Number(m2[1])).padStart(2, '0');
    const y = m2[3] ? m2[3] : year;
    if (mo) return `${y}-${String(mo).padStart(2, '0')}-${d}`;
  }
  return fallbackISO;
}

// ---------- Source 1: Finnhub ----------
async function fetchFinnhub(apiKey: string, fromISO: string, toISO: string): Promise<EconomicEvent[]> {
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${fromISO}&to=${toISO}&token=${apiKey}`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    throw new Error(`Finnhub ${r.status}: ${await r.text().catch(() => '')}`);
  }
  const j = await r.json();
  const arr: any[] = j?.economicCalendar || j?.economic || [];
  const events: EconomicEvent[] = arr.map((e: any) => {
    const country = String(e.country || '').toUpperCase().slice(0, 2) || 'US';
    const name = String(e.event || e.name || 'Economic Event');
    return {
      date: e.date ? String(e.date).slice(0, 10) : fromISO,
      time: e.time ? String(e.time) : undefined,
      country,
      event: name,
      impact: mapFinnhubImpact(e.impact),
      actual: e.actual != null && e.actual !== '' ? String(e.actual) : undefined,
      forecast: e.consensus != null && e.consensus !== '' ? String(e.consensus) : (e.estimate != null ? String(e.estimate) : undefined),
      previous: e.prev != null && e.prev !== '' ? String(e.prev) : undefined,
      source: 'Finnhub',
      url: undefined,
    };
  });
  return events;
}

// ---------- Source 2: web search ----------
async function fetchWebSearch(fromISO: string, toISO: string): Promise<EconomicEvent[]> {
  const zai = await ZAI.create();
  const results = await zai.functions.invoke('web_search', {
    query: 'economic calendar this week CPI NFP fed rate decision FOMC central bank unemployment',
    num: 15,
    recency_days: 7,
  });
  const arr = Array.isArray(results) ? results : [];
  const todayISO = fromISO;
  const events: EconomicEvent[] = [];
  for (const r of arr as any[]) {
    const title = r.name || r.title || '';
    const snippet = r.snippet || '';
    const host = r.host_name || r.source || '';
    const blob = `${title} ${snippet}`;
    const country = inferCountry(blob);
    const event = title.split(' - ')[0].split(' | ')[0].slice(0, 100) || 'Economic Event';
    const impact = inferImpactFromName(blob);
    const date = extractDate(blob, todayISO);
    // Pull time if mentioned
    const timeMatch = blob.match(/\b(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*(?:ET|EST|EDT|UTC|GMT)?/);
    const time = timeMatch ? `${timeMatch[1].toUpperCase()} ET` : undefined;
    events.push({
      date,
      time,
      country,
      event,
      impact,
      actual: undefined,
      forecast: undefined,
      previous: undefined,
      source: host || 'Web Search',
      url: r.url || undefined,
    });
  }
  // De-duplicate by event+date
  const seen = new Set<string>();
  const deduped: EconomicEvent[] = [];
  for (const e of events) {
    const k = `${e.date}|${e.event.toLowerCase()}|${e.country}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(e);
  }
  return deduped;
}

// ---------- Route ----------
export async function GET(_req: NextRequest) {
  const now = new Date();
  const from = new Date(now);
  const to = new Date(now);
  to.setDate(to.getDate() + 14);
  const fromISO = fmtDate(from);
  const toISO = fmtDate(to);

  // Try Finnhub first
  const finnhubKey = await getSetting<string>(SETTING_KEYS.finnhubApiKey, '');
  if (finnhubKey && typeof finnhubKey === 'string' && finnhubKey.trim().length > 5) {
    try {
      const events = await fetchFinnhub(finnhubKey.trim(), fromISO, toISO);
      if (events.length > 0) {
        return NextResponse.json<ApiResult<CalendarResponse>>({
          success: true,
          data: { events, source: 'finnhub' },
        });
      }
      // Empty finnhub → fall through to web search
    } catch (e: any) {
      console.warn('[economic-calendar] Finnhub failed, falling back to web search:', e?.message);
    }
  }

  // Fallback: web search
  try {
    const events = await fetchWebSearch(fromISO, toISO);
    return NextResponse.json<ApiResult<CalendarResponse>>({
      success: true,
      data: { events, source: 'web-search' },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e?.message || 'Economic calendar fetch failed' },
      { status: 502 },
    );
  }
}
