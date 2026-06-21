'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, RefreshCw, ArrowUp, ArrowDown, Minus, Layers3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape (matches /api/multi-timeframe)
// ---------------------------------------------------------------------------

interface TimeframeSnapshot {
  interval: '1h' | '4h' | '1d';
  trend: 'up' | 'down' | 'sideways';
  summaryScore: number;
  rsi14: number | null;
  macdHist: number | null;
}

interface ConfluenceRow {
  symbol: string;
  name: string;
  timeframes: TimeframeSnapshot[];
  alignmentScore: number;
  direction: 'long' | 'short' | 'neutral';
  agreeCount: number;
  total: number;
}

interface Envelope {
  success?: boolean;
  data?: ConfluenceRow[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trendIcon(trend: 'up' | 'down' | 'sideways'): React.ReactElement {
  if (trend === 'up') return <ArrowUp className="h-3 w-3 text-emerald-400" />;
  if (trend === 'down') return <ArrowDown className="h-3 w-3 text-rose-400" />;
  return <Minus className="h-3 w-3 text-muted-foreground" />;
}

function trendColor(trend: 'up' | 'down' | 'sideways'): string {
  if (trend === 'up') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (trend === 'down') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return 'border-border bg-muted/30 text-muted-foreground';
}

function scoreColor(score: number): string {
  if (score > 8) return 'text-emerald-400';
  if (score < -8) return 'text-rose-400';
  return 'text-muted-foreground';
}

function alignmentColor(score: number): { bg: string; fg: string; border: string } {
  if (score >= 100) return { bg: 'oklch(0.45 0.20 150 / 0.85)', fg: 'oklch(0.98 0.02 150)', border: 'oklch(0.55 0.20 150)' };
  if (score >= 67) return { bg: 'oklch(0.55 0.16 150 / 0.55)', fg: 'oklch(0.85 0.10 150)', border: 'oklch(0.65 0.16 150)' };
  if (score >= 33) return { bg: 'oklch(0.72 0.18 75 / 0.4)', fg: 'oklch(0.85 0.10 75)', border: 'oklch(0.65 0.16 75)' };
  return { bg: 'oklch(0.30 0.012 264 / 0.5)', fg: 'oklch(0.70 0.012 264)', border: 'oklch(0.35 0.012 264)' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MultiTimeframeClient(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [dirFilter, setDirFilter] = React.useState<'all' | 'long' | 'short' | 'neutral'>('all');

  const mtqQ = useQuery<ConfluenceRow[]>({
    queryKey: ['multi-timeframe'],
    queryFn: async () => {
      const res = await fetch('/api/multi-timeframe');
      if (!res.ok) throw new Error('multi-timeframe fetch failed');
      const json: Envelope = await res.json();
      if (!json.success) throw new Error(json.error ?? 'multi-timeframe error');
      return json.data ?? [];
    },
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });

  const all = mtqQ.data ?? [];

  const filtered = React.useMemo(() => {
    let out = all;
    if (dirFilter !== 'all') out = out.filter((r) => r.direction === dirFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
      );
    }
    return out;
  }, [all, dirFilter, query]);

  const stats = React.useMemo(() => {
    if (all.length === 0) return { total: 0, longCount: 0, shortCount: 0, neutralCount: 0, highConfluence: 0, avg: 0 };
    const longCount = all.filter((r) => r.direction === 'long').length;
    const shortCount = all.filter((r) => r.direction === 'short').length;
    const neutralCount = all.filter((r) => r.direction === 'neutral').length;
    const highConfluence = all.filter((r) => r.alignmentScore >= 67).length;
    const avg = all.reduce((s, r) => s + r.alignmentScore, 0) / all.length;
    return { total: all.length, longCount, shortCount, neutralCount, highConfluence, avg };
  }, [all]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <BarChart3 className="h-6 w-6 text-primary" />
            Multi-Timeframe Confluence
          </h1>
          <p className="text-xs text-muted-foreground">
            1h / 4h / 1d indicator confluence · alignment score = how many timeframes agree.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void mtqQ.refetch()}
          disabled={mtqQ.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', mtqQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Assets Scanned
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            High Confluence (≥67%)
          </div>
          <div className="mt-1 text-xl font-bold text-amber-300">{stats.highConfluence}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Long / Short
          </div>
          <div className="mt-1 text-xl font-bold">
            <span className="text-emerald-300">{stats.longCount}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-rose-300">{stats.shortCount}</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Avg Alignment
          </div>
          <div className="mt-1 text-xl font-bold text-sky-300">{stats.avg.toFixed(0)}%</div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/30 p-0.5">
          {(['all', 'long', 'short', 'neutral'] as const).map((d) => (
            <Button
              key={d}
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2.5 text-[11px] capitalize',
                dirFilter === d ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
              )}
              onClick={() => setDirFilter(d)}
            >
              {d}
            </Button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by symbol…"
          className="h-8 w-48 text-xs"
        />
        <span className="text-[11px] text-muted-foreground">
          {filtered.length} of {all.length}
        </span>
      </div>

      {/* Confluence grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary" />
            Confluence Matrix
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mtqQ.isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Computing indicators on 1h / 4h / 1d klines for all assets…
            </div>
          ) : mtqQ.error ? (
            <div className="py-8 text-center text-xs text-rose-300">
              Error: {mtqQ.error.message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matches.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">Asset</th>
                    <th className="px-3 py-2 text-center">1h</th>
                    <th className="px-3 py-2 text-center">4h</th>
                    <th className="px-3 py-2 text-center">1d</th>
                    <th className="px-3 py-2 text-right">Alignment</th>
                    <th className="px-3 py-2 text-center">Direction</th>
                    <th className="px-3 py-2 text-right">Agreement</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const a = alignmentColor(r.alignmentScore);
                    const tfByInterval = new Map(r.timeframes.map((t) => [t.interval, t]));
                    return (
                      <tr
                        key={r.symbol}
                        className="border-b border-border/50 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/crypto/${r.symbol.replace(/USDT$/, '')}`}
                            className="flex flex-col"
                          >
                            <span className="font-medium text-foreground hover:text-primary">
                              {r.symbol.replace(/USDT$/, '')}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{r.name}</span>
                          </Link>
                        </td>
                        {(['1h', '4h', '1d'] as const).map((interval) => {
                          const tf = tfByInterval.get(interval);
                          if (!tf) {
                            return (
                              <td key={interval} className="px-3 py-2 text-center text-muted-foreground">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={interval} className="px-3 py-2 text-center">
                              <div
                                className={cn(
                                  'mx-auto inline-flex w-16 flex-col items-center gap-0.5 rounded-md border px-1.5 py-1',
                                  trendColor(tf.trend),
                                )}
                              >
                                <div className="flex items-center gap-1 text-[10px] font-medium uppercase">
                                  {trendIcon(tf.trend)}
                                  {interval}
                                </div>
                                <div className={cn('font-mono text-[10px]', scoreColor(tf.summaryScore))}>
                                  {tf.summaryScore > 0 ? '+' : ''}
                                  {tf.summaryScore}
                                </div>
                              </div>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right">
                          <div
                            className="ml-auto inline-flex h-7 w-14 items-center justify-center rounded-md border font-mono text-xs font-bold"
                            style={{ backgroundColor: a.bg, color: a.fg, borderColor: a.border }}
                          >
                            {r.alignmentScore}%
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge
                            variant={
                              r.direction === 'long'
                                ? 'success'
                                : r.direction === 'short'
                                  ? 'rose'
                                  : 'muted'
                            }
                            className="capitalize"
                          >
                            {r.direction}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {r.agreeCount}/{r.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 p-3 text-[11px]">
          <div className="flex items-center gap-1.5">
            <ArrowUp className="h-3 w-3 text-emerald-400" />
            <span className="text-muted-foreground">Bullish (score &gt; +8)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowDown className="h-3 w-3 text-rose-400" />
            <span className="text-muted-foreground">Bearish (score &lt; -8)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Minus className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Neutral (|score| ≤ 8)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Alignment = agreeing TFs / total TFs</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
