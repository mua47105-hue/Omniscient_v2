'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Filter, Search, RefreshCw, Zap, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

interface MatchedFilter {
  key: string;
  label: string;
  detail: string;
}

interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  changePct24h?: number;
  matchedFilters: MatchedFilter[];
  indicators: {
    rsi14: number | null;
    macd: { histogram: number | null };
    ema12: number | null;
    ema26: number | null;
    bollinger: { upper: number | null; lower: number | null; middle: number | null };
    vwap: number | null;
    trend: 'up' | 'down' | 'sideways';
    summaryScore: number;
    lastClose: number | null;
  };
  nearSupport?: number;
  nearResistance?: number;
}

interface Envelope {
  success?: boolean;
  data?: ScreenerResult[];
  error?: string;
}

// ---------------------------------------------------------------------------
// All 14+1 filters (screener supports 15: rsi_os, rsi_ob, macd_bull, macd_bear,
// macd_bull_cross, macd_bear_cross, ema_bull, ema_bear, bb_breakout_up,
// bb_breakout_down, vol_spike, near_support, near_resistance, trend_up, trend_down)
// ---------------------------------------------------------------------------

const ALL_FILTERS: { key: string; label: string; tone: 'bull' | 'bear' | 'neutral' }[] = [
  { key: 'rsi_oversold', label: 'RSI Oversold', tone: 'bull' },
  { key: 'rsi_overbought', label: 'RSI Overbought', tone: 'bear' },
  { key: 'macd_bullish', label: 'MACD Bullish', tone: 'bull' },
  { key: 'macd_bearish', label: 'MACD Bearish', tone: 'bear' },
  { key: 'macd_bull_cross', label: 'MACD Bull Cross', tone: 'bull' },
  { key: 'macd_bear_cross', label: 'MACD Bear Cross', tone: 'bear' },
  { key: 'ema_bull', label: 'EMA Bull (12>26)', tone: 'bull' },
  { key: 'ema_bear', label: 'EMA Bear (12<26)', tone: 'bear' },
  { key: 'bb_breakout_up', label: 'BB Breakout Up', tone: 'bull' },
  { key: 'bb_breakout_down', label: 'BB Breakout Down', tone: 'bear' },
  { key: 'vol_spike', label: 'Volume Spike', tone: 'neutral' },
  { key: 'near_support', label: 'Near Support', tone: 'bull' },
  { key: 'near_resistance', label: 'Near Resistance', tone: 'bear' },
  { key: 'trend_up', label: 'Trend Up', tone: 'bull' },
  { key: 'trend_down', label: 'Trend Down', tone: 'bear' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScreenerClient(): React.ReactElement {
  const [enabled, setEnabled] = React.useState<Set<string>>(
    () => new Set(ALL_FILTERS.map((f) => f.key)),
  );
  const [query, setQuery] = React.useState('');
  const [scanKey, setScanKey] = React.useState(0);

  function toggleFilter(key: string): void {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const enabledList = Array.from(enabled);
  const filtersParam = enabledList.join(',');

  const scanQ = useQuery<ScreenerResult[]>({
    queryKey: ['screener-scan', filtersParam, scanKey],
    queryFn: async () => {
      const url = `/api/screener/scan?filters=${encodeURIComponent(filtersParam)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('screener scan failed');
      const json: Envelope = await res.json();
      if (!json.success) throw new Error(json.error ?? 'scan error');
      return json.data ?? [];
    },
    enabled: enabled.size > 0,
    staleTime: 60_000,
  });

  const allResults = scanQ.data ?? [];

  const filtered = React.useMemo(() => {
    if (!query.trim()) return allResults;
    const q = query.trim().toLowerCase();
    return allResults.filter(
      (r) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [allResults, query]);

  // Stats
  const stats = React.useMemo(() => {
    const matches = allResults.length;
    const bullSignals = allResults.reduce(
      (s, r) => s + r.matchedFilters.filter((f) => f.key.includes('bull') || f.key === 'rsi_oversold' || f.key === 'bb_breakout_up' || f.key === 'near_support' || f.key === 'trend_up').length,
      0,
    );
    const bearSignals = allResults.reduce(
      (s, r) => s + r.matchedFilters.filter((f) => f.key.includes('bear') || f.key === 'rsi_overbought' || f.key === 'bb_breakout_down' || f.key === 'near_resistance' || f.key === 'trend_down').length,
      0,
    );
    return { matches, bullSignals, bearSignals };
  }, [allResults]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Filter className="h-6 w-6 text-primary" />
            Market Screener
          </h1>
          <p className="text-xs text-muted-foreground">
            15 technical filters across all crypto assets — RSI, MACD, EMA, Bollinger, volume, S/R.
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={() => setScanKey((k) => k + 1)}
          disabled={scanQ.isFetching}
        >
          <Zap className={cn('h-3.5 w-3.5', scanQ.isFetching && 'animate-pulse')} />
          Scan Now
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Matches
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{stats.matches}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Bull Signals
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-300">{stats.bullSignals}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Bear Signals
          </div>
          <div className="mt-1 text-xl font-bold text-rose-300">{stats.bearSignals}</div>
        </Card>
      </div>

      {/* Filter toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Filters ({enabled.size} active)</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setEnabled(new Set(ALL_FILTERS.map((f) => f.key)))}
              >
                Select all
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setEnabled(new Set())}
              >
                Clear
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {ALL_FILTERS.map((f) => {
              const on = enabled.has(f.key);
              const tone =
                f.tone === 'bull'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : f.tone === 'bear'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300';
              return (
                <button
                  key={f.key}
                  onClick={() => toggleFilter(f.key)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all',
                    on
                      ? tone
                      : 'border-border bg-muted/20 text-muted-foreground hover:bg-muted/40',
                  )}
                >
                  <span className="mr-1.5 inline-flex h-2 w-2 rounded-full" style={{
                    backgroundColor: on
                      ? f.tone === 'bull'
                        ? 'oklch(0.72 0.18 160)'
                        : f.tone === 'bear'
                          ? 'oklch(0.65 0.22 25)'
                          : 'oklch(0.72 0.18 75)'
                      : 'transparent',
                  }} />
                  {f.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="flex items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter matches…"
            className="h-9 w-56 pl-8 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void scanQ.refetch()}
          disabled={scanQ.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', scanQ.isFetching && 'animate-spin')} />
          Re-run
        </Button>
      </div>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Scan Results</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              {filtered.length} matches · sorted by filter count
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scanQ.isLoading ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Scanning all crypto assets against {enabled.size} filters…
            </div>
          ) : scanQ.error ? (
            <div className="py-8 text-center text-xs text-rose-300">
              Error: {scanQ.error.message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              No matches with the current filter set. Enable more filters or click
              &quot;Scan Now&quot; to re-run.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filtered.slice(0, 40).map((r) => (
                <ResultCard key={r.symbol} result={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultCard
// ---------------------------------------------------------------------------

function ResultCard({ result }: { result: ScreenerResult }): React.ReactElement {
  const base = result.symbol.replace(/USDT$/, '');
  const positive = (result.changePct24h ?? 0) >= 0;
  const bullCount = result.matchedFilters.filter(
    (f) =>
      f.key.includes('bull') ||
      f.key === 'rsi_oversold' ||
      f.key === 'bb_breakout_up' ||
      f.key === 'near_support' ||
      f.key === 'trend_up',
  ).length;
  const bearCount = result.matchedFilters.filter(
    (f) =>
      f.key.includes('bear') ||
      f.key === 'rsi_overbought' ||
      f.key === 'bb_breakout_down' ||
      f.key === 'near_resistance' ||
      f.key === 'trend_down',
  ).length;
  const neutralCount = result.matchedFilters.length - bullCount - bearCount;

  const bias = bullCount > bearCount ? 'bull' : bearCount > bullCount ? 'bear' : 'mixed';

  return (
    <Card className={cn(
      'p-3 ring-1',
      bias === 'bull'
        ? 'ring-emerald-500/30'
        : bias === 'bear'
          ? 'ring-rose-500/30'
          : 'ring-border',
    )}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <Link href={`/crypto/${base}`} className="flex flex-col">
          <span className="font-semibold text-foreground hover:text-primary">
            {base}
          </span>
          <span className="text-[10px] text-muted-foreground">{result.name}</span>
        </Link>
        <div className="text-right">
          <div className="font-mono text-sm font-bold text-foreground">
            ${fmtPrice(result.price)}
          </div>
          <div className={cn(
            'font-mono text-[11px]',
            positive ? 'text-emerald-400' : 'text-rose-400',
          )}>
            {positive ? '+' : ''}
            {(result.changePct24h ?? 0).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Bias + counts */}
      <div className="mt-2 flex items-center gap-1.5">
        <Badge
          variant={bias === 'bull' ? 'success' : bias === 'bear' ? 'rose' : 'muted'}
          className="text-[10px]"
        >
          {bias === 'bull' ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : bias === 'bear' ? (
            <TrendingDown className="h-2.5 w-2.5" />
          ) : null}
          {bias}
        </Badge>
        <span className="text-[10px] text-emerald-400">{bullCount} bull</span>
        <span className="text-[10px] text-muted-foreground">·</span>
        <span className="text-[10px] text-rose-400">{bearCount} bear</span>
        {neutralCount > 0 ? (
          <>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-amber-300">{neutralCount} neutral</span>
          </>
        ) : null}
      </div>

      {/* Indicators mini-row */}
      <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
        <MiniStat label="RSI" value={result.indicators.rsi14?.toFixed(0) ?? '—'} tone={
          result.indicators.rsi14 == null ? 'muted'
          : result.indicators.rsi14 < 30 ? 'emerald'
          : result.indicators.rsi14 > 70 ? 'rose'
          : 'muted'
        } />
        <MiniStat label="MACD" value={result.indicators.macd.histogram?.toFixed(1) ?? '—'} tone={
          result.indicators.macd.histogram == null ? 'muted'
          : result.indicators.macd.histogram > 0 ? 'emerald'
          : 'rose'
        } />
        <MiniStat label="EMA" value={result.indicators.ema12 != null && result.indicators.ema26 != null ? (result.indicators.ema12 > result.indicators.ema26 ? 'bull' : 'bear') : '—'} tone={
          result.indicators.ema12 == null || result.indicators.ema26 == null ? 'muted'
          : result.indicators.ema12 > result.indicators.ema26 ? 'emerald'
          : 'rose'
        } />
        <MiniStat label="Trend" value={result.indicators.trend} tone={
          result.indicators.trend === 'up' ? 'emerald'
          : result.indicators.trend === 'down' ? 'rose'
          : 'muted'
        } />
      </div>

      {/* Matched filters */}
      <div className="mt-2 flex flex-wrap gap-1">
        {result.matchedFilters.map((f, i) => {
          const tone =
            f.key.includes('bull') || f.key === 'rsi_oversold' || f.key === 'bb_breakout_up' || f.key === 'near_support' || f.key === 'trend_up'
              ? 'success'
              : f.key.includes('bear') || f.key === 'rsi_overbought' || f.key === 'bb_breakout_down' || f.key === 'near_resistance' || f.key === 'trend_down'
                ? 'rose'
                : 'warning';
          return (
            <Badge key={i} variant={tone} className="text-[9px]" title={f.detail}>
              {f.label}
            </Badge>
          );
        })}
      </div>

      {/* S/R levels */}
      {result.nearSupport || result.nearResistance ? (
        <div className="mt-2 flex items-center gap-3 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          {result.nearSupport ? (
            <span>
              Support <span className="font-mono text-emerald-300">${fmtPrice(result.nearSupport)}</span>
            </span>
          ) : null}
          {result.nearResistance ? (
            <span>
              Resistance <span className="font-mono text-rose-300">${fmtPrice(result.nearResistance)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'muted';
}): React.ReactElement {
  const cls = tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-muted-foreground';
  return (
    <div className="rounded border border-border bg-muted/20 px-1.5 py-1 text-center">
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-[11px]', cls)}>{value}</div>
    </div>
  );
}
