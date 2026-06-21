'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO, differenceInMilliseconds, isToday, isTomorrow, differenceInCalendarDays } from 'date-fns';
import {
  CalendarClock, RefreshCw, AlertTriangle, ExternalLink, Globe2, Flame,
  TrendingUp, Clock, Zap, ChevronRight, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult } from '@/lib/types';

// ---------- Types ----------
interface EconomicEvent {
  date: string;
  time?: string;
  country: string;
  event: string;
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

async function fetchCalendar(): Promise<CalendarResponse> {
  const r = await fetch('/api/economic-calendar', { cache: 'no-store' });
  const j: ApiResult<CalendarResponse> = await r.json();
  if (!j.success || !j.data) throw new Error(j.error || 'Failed to fetch economic calendar');
  return j.data;
}

// ---------- Constants ----------
const COUNTRY_FLAG: Record<string, { flag: string; label: string }> = {
  US: { flag: '🇺🇸', label: 'US' },
  EU: { flag: '🇪🇺', label: 'EU' },
  IN: { flag: '🇮🇳', label: 'IN' },
  UK: { flag: '🇬🇧', label: 'UK' },
  JP: { flag: '🇯🇵', label: 'JP' },
  CN: { flag: '🇨🇳', label: 'CN' },
  CA: { flag: '🇨🇦', label: 'CA' },
  AU: { flag: '🇦🇺', label: 'AU' },
  CH: { flag: '🇨🇭', label: 'CH' },
};

const IMPACT_STYLES: Record<'high' | 'medium' | 'low', { badge: string; dot: string; row: string }> = {
  high: {
    badge: 'bg-rose-500/10 text-rose-500 border-rose-500/30',
    dot: 'bg-rose-500',
    row: 'border-l-rose-500',
  },
  medium: {
    badge: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    dot: 'bg-amber-500',
    row: 'border-l-amber-500',
  },
  low: {
    badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30',
    dot: 'bg-zinc-500',
    row: 'border-l-zinc-500',
  },
};

type ImpactFilter = 'all' | 'high' | 'medium' | 'low';
type CountryFilter = 'all' | 'US' | 'EU' | 'IN' | 'UK' | 'JP';
type RangeFilter = 'week' | '2weeks' | 'month';

// ---------- Helpers ----------
function getCountdown(isoDate: string, timeStr?: string): { label: string; ms: number } {
  // Combine date + time (assume ET) into a target — we don't have timezone parsing,
  // so treat the time as approximate local interpretation for countdown ordering.
  let target: Date;
  if (timeStr) {
    // Try "8:30 AM ET" → 08:30 local
    const m = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2]);
      const ap = (m[3] || '').toUpperCase();
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      target = parseISO(isoDate);
      target.setHours(h, min, 0, 0);
    } else {
      target = parseISO(isoDate);
    }
  } else {
    target = parseISO(isoDate);
    target.setHours(13, 30, 0, 0); // default ET premarket-ish if no time
  }
  const ms = differenceInMilliseconds(target, new Date());
  if (ms <= 0) return { label: 'Released', ms: 0 };
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days >= 1) return { label: `in ${days}d ${hours}h`, ms };
  if (hours >= 1) return { label: `in ${hours}h ${mins}m`, ms };
  return { label: `in ${mins}m`, ms };
}

function formatDateHeader(isoDate: string): string {
  try {
    const d = parseISO(isoDate);
    const dayName = format(d, 'EEE');
    const monDay = format(d, 'MMM d');
    let suffix = '';
    if (isToday(d)) suffix = ' — Today';
    else if (isTomorrow(d)) suffix = ' — Tomorrow';
    return `${dayName} ${monDay}${suffix}`;
  } catch {
    return isoDate;
  }
}

function compareActualVsForecast(actual?: string, forecast?: string): 'beat' | 'miss' | 'inline' | 'na' {
  if (!actual) return 'na';
  const a = parseFloat(actual.replace(/[^0-9.\-]/g, ''));
  if (Number.isNaN(a)) return 'na';
  if (!forecast) return 'na';
  const f = parseFloat(forecast.replace(/[^0-9.\-]/g, ''));
  if (Number.isNaN(f)) return 'na';
  // Convention for most macro prints: higher than forecast = bullish currency.
  // We just compare magnitude here for color coding.
  const diff = a - f;
  const tol = Math.abs(f) * 0.01 || 0.01;
  if (Math.abs(diff) <= tol) return 'inline';
  return diff > 0 ? 'beat' : 'miss';
}

// ---------- Sub-components ----------
function ImpactBadge({ impact }: { impact: 'high' | 'medium' | 'low' }) {
  const s = IMPACT_STYLES[impact];
  return (
    <Badge variant="outline" className={cn('gap-1 text-[10px] font-semibold uppercase tracking-wide', s.badge)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {impact}
    </Badge>
  );
}

function CountryCell({ country }: { country: string }) {
  const c = COUNTRY_FLAG[country] || { flag: '🏳️', label: country };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-base leading-none">{c.flag}</span>
      <span className="text-xs font-semibold tabular-nums">{c.label}</span>
    </span>
  );
}

function StatPill({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string | number; accent: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accent)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
            <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterPill({ active, onClick, children, accent }: { active: boolean; onClick: () => void; children: React.ReactNode; accent?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? accent || 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40'
          : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  );
}

function HighImpactCallout({ events }: { events: EconomicEvent[] }) {
  const now = new Date();
  const upcoming = useMemo(() => {
    return events
      .filter((e) => e.impact === 'high')
      .filter((e) => {
        // include events today or in the future (released today still show if not past)
        const d = parseISO(e.date);
        return differenceInCalendarDays(d, now) >= 0;
      })
      .sort((a, b) => {
        const ta = parseISO(a.date).getTime();
        const tb = parseISO(b.date).getTime();
        return ta - tb;
      })
      .slice(0, 3);
  }, [events]);

  if (upcoming.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-rose-500/30 bg-gradient-to-br from-rose-500/[0.06] via-card to-card overflow-hidden">
        <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Flame className="h-4 w-4 text-rose-500" />
            High-Impact Watch
            <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-500">
              Next {upcoming.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((e, idx) => {
              const cd = getCountdown(e.date, e.time);
              const country = COUNTRY_FLAG[e.country] || { flag: '🏳️', label: e.country };
              return (
                <div
                  key={`${e.date}-${e.event}-${idx}`}
                  className="relative rounded-lg border border-border/60 bg-card/60 p-3 backdrop-blur-sm"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg leading-none">{country.flag}</span>
                      <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-500">
                        HIGH
                      </Badge>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-muted-foreground">{formatDateHeader(e.date)}</div>
                      {e.time && <div className="text-[10px] tabular-nums text-muted-foreground">{e.time}</div>}
                    </div>
                  </div>
                  <div className="text-sm font-semibold leading-snug mb-2 line-clamp-2">{e.event}</div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{e.source || '—'}</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                        cd.ms === 0
                          ? 'bg-zinc-500/10 text-zinc-400'
                          : 'bg-rose-500/10 text-rose-500'
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {cd.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function EventRow({ e }: { e: EconomicEvent }) {
  const compare = compareActualVsForecast(e.actual, e.forecast);
  const hasActual = !!e.actual;
  const s = IMPACT_STYLES[e.impact];
  return (
    <div
      className={cn(
        'grid grid-cols-12 items-center gap-2 border-l-2 px-3 py-2.5 hover:bg-muted/40 transition-colors',
        s.row
      )}
    >
      {/* Time */}
      <div className="col-span-3 sm:col-span-2">
        <span className="text-xs tabular-nums text-muted-foreground">{e.time || 'All day'}</span>
      </div>
      {/* Country */}
      <div className="col-span-3 sm:col-span-2">
        <CountryCell country={e.country} />
      </div>
      {/* Impact */}
      <div className="hidden sm:block sm:col-span-2">
        <ImpactBadge impact={e.impact} />
      </div>
      {/* Event */}
      <div className="col-span-6 sm:col-span-3 min-w-0">
        <div className="text-sm font-semibold leading-tight truncate" title={e.event}>
          {e.event}
        </div>
        <div className="sm:hidden mt-1">
          <ImpactBadge impact={e.impact} />
        </div>
      </div>
      {/* Previous */}
      <div className="hidden md:block md:col-span-1 text-right">
        <span className="text-xs tabular-nums text-muted-foreground">{e.previous || '—'}</span>
      </div>
      {/* Forecast */}
      <div className="hidden md:block md:col-span-1 text-right">
        <span className="text-xs tabular-nums text-muted-foreground">{e.forecast || '—'}</span>
      </div>
      {/* Actual */}
      <div className="col-span-12 sm:col-span-3 md:col-span-1 text-right">
        {hasActual ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums',
              compare === 'beat' && 'bg-emerald-500/10 text-emerald-500',
              compare === 'miss' && 'bg-rose-500/10 text-rose-500',
              compare === 'inline' && 'bg-amber-500/10 text-amber-500',
              compare === 'na' && 'bg-zinc-500/10 text-zinc-400'
            )}
          >
            {compare === 'beat' && <TrendingUp className="h-3 w-3" />}
            {compare === 'miss' && <AlertCircle className="h-3 w-3" />}
            {e.actual}
          </span>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

function DaySection({ date, events }: { date: string; events: EconomicEvent[] }) {
  const highCount = events.filter((e) => e.impact === 'high').length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden rounded-lg border border-border/60 bg-card/40"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{formatDateHeader(date)}</h3>
          <span className="text-xs text-muted-foreground">
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
        </div>
        {highCount > 0 && (
          <Badge variant="outline" className="text-[10px] border-rose-500/40 text-rose-500">
            <Flame className="h-3 w-3 mr-1" />
            {highCount} high-impact
          </Badge>
        )}
      </div>
      <div className="divide-y divide-border/40">
        {events.map((e, idx) => (
          <EventRow key={`${date}-${idx}`} e={e} />
        ))}
      </div>
    </motion.div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="overflow-hidden rounded-lg border border-border/60">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="divide-y divide-border/40">
            {[0, 1, 2].map((j) => (
              <div key={j} className="grid grid-cols-12 items-center gap-2 px-3 py-3">
                <Skeleton className="col-span-3 sm:col-span-2 h-4" />
                <Skeleton className="col-span-3 sm:col-span-2 h-4" />
                <Skeleton className="hidden sm:block sm:col-span-2 h-4" />
                <Skeleton className="col-span-6 sm:col-span-3 h-4" />
                <Skeleton className="hidden md:block md:col-span-1 h-4" />
                <Skeleton className="hidden md:block md:col-span-1 h-4" />
                <Skeleton className="col-span-12 sm:col-span-3 md:col-span-1 h-4" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-500/40 bg-rose-500/[0.04]">
      <CardContent className="py-8 flex flex-col items-center text-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <div>
          <div className="text-sm font-semibold text-rose-500">Failed to load economic calendar</div>
          <div className="text-xs text-muted-foreground mt-1 max-w-md">{message}</div>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="border-rose-500/40 text-rose-500 hover:bg-rose-500/10">
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-border/60">
      <CardContent className="py-12 flex flex-col items-center text-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
          <CalendarClock className="h-6 w-6" />
        </div>
        <div>
          <div className="text-base font-semibold">No economic events found</div>
          <div className="text-sm text-muted-foreground mt-1 max-w-md">
            If you have a Finnhub API key, add it in <span className="font-semibold text-emerald-500">Settings → Data Sources</span> for structured calendar data. Otherwise, the system uses web search as a fallback.
          </div>
        </div>
        <a href="/settings/data-sources">
          <Button variant="outline" size="sm" className="border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10">
            Configure Data Sources
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </a>
      </CardContent>
    </Card>
  );
}

// ---------- Main ----------
export function EconomicCalendarClient() {
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('all');
  const [countryFilter, setCountryFilter] = useState<CountryFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('2weeks');
  const [tick, setTick] = useState(0); // re-render for countdown refresh

  const q = useQuery({
    queryKey: ['economic-calendar'],
    queryFn: fetchCalendar,
    refetchInterval: 10 * 60 * 1000, // auto-refresh every 10 min
    retry: 1,
  });

  // Recompute countdowns every minute
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const allEvents = q.data?.events ?? [];
  const source = q.data?.source;

  // Apply filters
  const filtered = useMemo(() => {
    const now = new Date();
    let events = allEvents;

    // Range filter
    if (rangeFilter !== '2weeks') {
      const days = rangeFilter === 'week' ? 7 : 30;
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() + days);
      events = events.filter((e) => {
        try {
          const d = parseISO(e.date);
          return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && d <= cutoff;
        } catch {
          return true;
        }
      });
    }

    // Impact filter
    if (impactFilter !== 'all') {
      events = events.filter((e) => e.impact === impactFilter);
    }

    // Country filter
    if (countryFilter !== 'all') {
      events = events.filter((e) => e.country === countryFilter);
    }

    return events;
  }, [allEvents, impactFilter, countryFilter, rangeFilter, tick]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, EconomicEvent[]>();
    for (const e of filtered) {
      const k = e.date || 'unknown';
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    // sort events within each day by time (early/no-time last)
    for (const [k, list] of map) {
      list.sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return a.time.localeCompare(b.time);
      });
      map.set(k, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  // Stats
  const stats = useMemo(() => {
    const high = allEvents.filter((e) => e.impact === 'high').length;
    const countries = new Set(allEvents.map((e) => e.country)).size;
    // Next event
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = allEvents
      .filter((e) => {
        try {
          return parseISO(e.date) >= today;
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    const next = upcoming[0];
    const nextCountdown = next ? getCountdown(next.date, next.time).label : '—';
    return {
      total: allEvents.length,
      high,
      countries,
      nextCountdown,
    };
  }, [allEvents, tick]);

  const refetching = q.isFetching;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Economic Calendar</h1>
            {source && (
              <Badge
                className={
                  source === 'finnhub'
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10'
                    : 'bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/10'
                }
              >
                <span className="relative flex h-1.5 w-1.5 mr-1">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 bg-current" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                {source === 'finnhub' ? 'Finnhub' : 'Web Search'}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Upcoming macro events that move markets — CPI, NFP, Fed decisions, central bank meetings
          </p>
        </div>
        <button
          onClick={() => {
            q.refetch();
            toast.success('Refreshing economic calendar…');
          }}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refetching && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatPill icon={CalendarClock} label="Total Events" value={stats.total} accent="bg-emerald-500/10 text-emerald-500" />
        <StatPill icon={Flame} label="High-Impact" value={stats.high} accent="bg-rose-500/10 text-rose-500" />
        <StatPill icon={Globe2} label="Countries" value={stats.countries} accent="bg-teal-500/10 text-teal-500" />
        <StatPill icon={Zap} label="Next Event" value={stats.nextCountdown} accent="bg-amber-500/10 text-amber-500" />
      </div>

      {/* High-impact callout */}
      {!q.isLoading && !q.isError && allEvents.length > 0 && <HighImpactCallout events={allEvents} />}

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Impact</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={impactFilter === 'all'} onClick={() => setImpactFilter('all')}>
              All
            </FilterPill>
            <FilterPill
              active={impactFilter === 'high'}
              onClick={() => setImpactFilter('high')}
              accent="bg-rose-500/15 text-rose-500 border-rose-500/40"
            >
              High
            </FilterPill>
            <FilterPill
              active={impactFilter === 'medium'}
              onClick={() => setImpactFilter('medium')}
              accent="bg-amber-500/15 text-amber-500 border-amber-500/40"
            >
              Medium
            </FilterPill>
            <FilterPill
              active={impactFilter === 'low'}
              onClick={() => setImpactFilter('low')}
              accent="bg-zinc-500/15 text-zinc-400 border-zinc-500/40"
            >
              Low
            </FilterPill>
          </div>
        </div>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Country</span>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill active={countryFilter === 'all'} onClick={() => setCountryFilter('all')}>
              All
            </FilterPill>
            {(['US', 'EU', 'IN', 'UK', 'JP'] as CountryFilter[]).map((c) => (
              <FilterPill key={c} active={countryFilter === c} onClick={() => setCountryFilter(c)}>
                {COUNTRY_FLAG[c]?.flag} {c}
              </FilterPill>
            ))}
          </div>
        </div>

        <div className="h-5 w-px bg-border/60 hidden sm:block" />

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Range</span>
          <Select value={rangeFilter} onValueChange={(v) => setRangeFilter(v as RangeFilter)}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="2weeks">Next 2 Weeks</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Calendar grid */}
      {q.isLoading ? (
        <LoadingSkeleton />
      ) : q.isError ? (
        <ErrorCard message={q.error?.message || 'Unknown error'} onRetry={() => q.refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, events]) => (
            <DaySection key={date} date={date} events={events} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground pt-2">
        <span className="flex items-center gap-1">
          <Globe2 className="h-3 w-3" />
          {source === 'finnhub' ? 'Finnhub Economic Calendar' : 'Aggregated from web search'}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Auto-refreshes every 10 min
        </span>
        <a
          href="https://www.investing.com/economic-calendar/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Investing.com
        </a>
      </div>
    </div>
  );
}
