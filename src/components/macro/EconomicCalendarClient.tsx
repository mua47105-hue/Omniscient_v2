'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Flag, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EconEvent {
  id: string;
  country: string;
  event: string;
  date: string;
  impact: 'low' | 'medium' | 'high';
  actual?: string | null;
  estimate?: string | null;
  previous?: string | null;
  source: 'finnhub' | 'mock';
}

interface CalendarResponse {
  success?: boolean;
  data?: EconEvent[];
  source?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { date: '—', time: '' };
  return {
    date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

function impactVariant(impact: string): 'success' | 'warning' | 'rose' {
  if (impact === 'high') return 'rose';
  if (impact === 'medium') return 'warning';
  return 'success';
}

function countryFlag(code: string): string {
  // Map ISO-2 → emoji flag
  const map: Record<string, string> = {
    US: '🇺🇸',
    EU: '🇪🇺',
    UK: '🇬🇧',
    JP: '🇯🇵',
    CN: '🇨🇳',
    DE: '🇩🇪',
    FR: '🇫🇷',
    CA: '🇨🇦',
    AU: '🇦🇺',
    NZ: '🇳🇿',
    CH: '🇨🇭',
  };
  return map[code.toUpperCase()] ?? '🏳️';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EconomicCalendarClient(): React.ReactElement {
  const q = useQuery<EconEvent[]>({
    queryKey: ['economic-calendar'],
    queryFn: async () => {
      const res = await fetch('/api/economic-calendar?days=14');
      if (!res.ok) throw new Error('calendar fetch failed');
      const json: CalendarResponse = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 600_000,
    staleTime: 300_000,
  });

  const events = q.data ?? [];
  const source = q.data ? (q.data as any)?.source : undefined;
  const highCount = events.filter((e) => e.impact === 'high').length;
  const mediumCount = events.filter((e) => e.impact === 'medium').length;

  // Group by date.
  const grouped = React.useMemo(() => {
    const map = new Map<string, EconEvent[]>();
    for (const e of events) {
      const key = fmtDate(e.date).date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Economic Calendar</h1>
        <p className="text-xs text-muted-foreground">
          Upcoming high-impact economic releases — CPI, FOMC, NFP, PCE, central bank decisions.
          {source === 'mock' ? ' Showing curated mock events — set a finnhub API key in Settings → Data Sources for live data.' : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total Events
              </span>
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">{events.length}</div>
          </CardContent>
        </Card>
        <Card className="border-rose-500/30 ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                High Impact
              </span>
              <Flag className="h-4 w-4 text-rose-300" />
            </div>
            <div className="mt-2 text-2xl font-bold text-rose-300">{highCount}</div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/30 ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Medium Impact
              </span>
              <TrendingUp className="h-4 w-4 text-amber-300" />
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-300">{mediumCount}</div>
          </CardContent>
        </Card>
      </div>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading calendar…
          </CardContent>
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">No upcoming events in the next 14 days.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, items]) => (
            <Card key={date}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs">
                  <CalendarClock className="h-3.5 w-3.5 text-primary" />
                  {date}
                  <Badge variant="muted" className="text-[10px]">
                    {items.length} {items.length === 1 ? 'event' : 'events'}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Flag</TableHead>
                      <TableHead className="w-16">Country</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead className="w-20">Time</TableHead>
                      <TableHead className="w-20">Impact</TableHead>
                      <TableHead className="text-right">Estimate</TableHead>
                      <TableHead className="text-right">Previous</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((e) => {
                      const { time } = fmtDate(e.date);
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="text-base">{countryFlag(e.country)}</TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {e.country}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-foreground">
                            {e.event}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {time}
                          </TableCell>
                          <TableCell>
                            <Badge variant={impactVariant(e.impact)} className="text-[10px] capitalize">
                              {e.impact}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {e.estimate ?? '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {e.previous ?? '—'}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right font-mono text-xs',
                              e.actual == null
                                ? 'text-muted-foreground'
                                : 'text-emerald-400',
                            )}
                          >
                            {e.actual ?? '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
