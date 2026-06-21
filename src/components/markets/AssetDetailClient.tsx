'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft,
  Activity,
  Gauge,
  Newspaper,
  RefreshCw,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

interface KlineLite {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
}

interface IndicatorsLite {
  sma20: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null };
  bollinger: { upper: number | null; middle: number | null; lower: number | null };
  vwap: number | null;
  atr14: number | null;
  lastClose: number | null;
  trend: 'up' | 'down' | 'sideways';
  votes: { rsi: number; macd: number; ema: number; bollinger: number; vwap: number };
  summaryScore: number;
}

interface ScanResponse {
  success?: boolean;
  data?: {
    symbol: string;
    klines: KlineLite[];
    indicators: IndicatorsLite | null;
    klineCount: number;
    message?: string;
  };
}

interface QuoteLite {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  change?: number;
  changePercent?: number;
  previousClose?: number;
  currency?: string;
  fetchedAt: number;
}

interface QuotesResponse {
  success?: boolean;
  data?: QuoteLite[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number | null | undefined, currency?: string): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const prefix = currency && currency !== 'USD' ? `${currency} ` : '$';
  if (n >= 1000) return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `${prefix}${n.toFixed(2)}`;
  return `${prefix}${n.toFixed(4)}`;
}

function classBadge(c: string): { label: string; variant: 'info' | 'violet' | 'warning' | 'success' } {
  switch (c) {
    case 'forex':
      return { label: 'Forex', variant: 'info' };
    case 'stocks':
      return { label: 'Stocks', variant: 'violet' };
    case 'indices':
      return { label: 'Index', variant: 'warning' };
    case 'commodities':
      return { label: 'Commodity', variant: 'success' };
    default:
      return { label: c, variant: 'info' };
  }
}

function rsiHint(rsi: number | null): string {
  if (rsi == null) return '';
  if (rsi >= 70) return 'overbought';
  if (rsi <= 30) return 'oversold';
  if (rsi > 55) return 'bullish';
  if (rsi < 45) return 'bearish';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AssetDetailClientProps {
  symbol: string;
}

export function AssetDetailClient({ symbol }: AssetDetailClientProps): React.ReactElement {
  const scanQ = useQuery<ScanResponse['data']>({
    queryKey: ['markets-scan', symbol],
    queryFn: async () => {
      const res = await fetch(`/api/markets/scan?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error('markets scan fetch failed');
      const json: ScanResponse = await res.json();
      return json.data;
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  // Pull the asset name + class from the bulk quotes endpoint.
  const quotesQ = useQuery<QuoteLite | null>({
    queryKey: ['markets-quote-for', symbol],
    queryFn: async () => {
      const res = await fetch('/api/markets/quotes');
      if (!res.ok) throw new Error('quotes fetch failed');
      const json: QuotesResponse = await res.json();
      const list = json.data ?? [];
      return list.find((q) => q.symbol === symbol) ?? null;
    },
    staleTime: 60_000,
  });

  const klines = scanQ.data?.klines ?? [];
  const indicators = scanQ.data?.indicators ?? null;
  const quote = quotesQ.data;

  const chartData = React.useMemo(
    () =>
      klines.map((k) => ({
        time: new Date(k.openTime).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
        }),
        close: k.close,
        bbUpper: indicators?.bollinger.upper ?? null,
        bbMiddle: indicators?.bollinger.middle ?? null,
        bbLower: indicators?.bollinger.lower ?? null,
        ema12: indicators?.ema12 ?? null,
        ema26: indicators?.ema26 ?? null,
      })),
    [klines, indicators],
  );

  const positive = (quote?.changePercent ?? 0) >= 0;
  const badge = classBadge(quote?.assetClass ?? '');

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/markets">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {quote?.name ?? symbol}
              </h1>
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {indicators ? (
                <Badge
                  variant={
                    indicators.trend === 'up'
                      ? 'success'
                      : indicators.trend === 'down'
                        ? 'rose'
                        : 'muted'
                  }
                  className="capitalize"
                >
                  {indicators.trend}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{symbol} · Yahoo Finance · 1d klines</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-foreground">
              {fmtPrice(quote?.price, quote?.currency)}
            </div>
            <div className={cn('font-mono text-xs', positive ? 'text-emerald-400' : 'text-rose-400')}>
              {quote?.change != null ? `${positive ? '+' : ''}${quote.change.toFixed(2)}` : '—'}{' '}
              ({positive ? '+' : ''}
              {(quote?.changePercent ?? 0).toFixed(2)}%)
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void scanQ.refetch()}
            disabled={scanQ.isFetching}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', scanQ.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Price"
          value={fmtPrice(quote?.price, quote?.currency)}
          icon={<TrendingUp className="h-3 w-3" />}
          tone="amber"
        />
        <StatTile
          label="24h Change"
          value={
            quote?.change != null
              ? `${positive ? '+' : ''}${quote.change.toFixed(2)}`
              : '—'
          }
          icon={positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          tone={positive ? 'emerald' : 'rose'}
        />
        <StatTile
          label="Prev Close"
          value={fmtPrice(quote?.previousClose, quote?.currency)}
          icon={<Activity className="h-3 w-3" />}
          tone="sky"
        />
        <StatTile
          label="RSI 14"
          value={indicators?.rsi14?.toFixed(1) ?? '—'}
          icon={<Gauge className="h-3 w-3" />}
          tone={
            indicators?.rsi14 == null
              ? 'muted'
              : indicators.rsi14 >= 70
                ? 'rose'
                : indicators.rsi14 <= 30
                  ? 'emerald'
                  : 'amber'
          }
        />
      </div>

      {/* Chart + indicators row */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Price Chart (daily) · Bollinger + EMA overlay
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scanQ.isLoading ? (
              <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
                Loading klines…
              </div>
            ) : chartData.length === 0 ? (
              <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
                No kline data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={360}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <defs>
                    <linearGradient id="market-price-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="oklch(0.72 0.18 256)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="oklch(0.72 0.18 256)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    orientation="right"
                    tickFormatter={(v: number) => fmtPrice(v, quote?.currency)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'oklch(0.20 0.014 264)',
                      border: '1px solid oklch(0.30 0.014 264 / 0.7)',
                      borderRadius: '8px',
                      fontSize: '11px',
                      color: 'oklch(0.97 0.005 264)',
                    }}
                    labelStyle={{ color: 'oklch(0.70 0.012 264)' }}
                    formatter={(v: number, n: string) => [fmtPrice(v, quote?.currency), n]}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke="oklch(0.72 0.18 256)"
                    strokeWidth={1.6}
                    fill="url(#market-price-area)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bbUpper"
                    stroke="oklch(0.65 0.18 25)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bbMiddle"
                    stroke="oklch(0.70 0.012 264)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bbLower"
                    stroke="oklch(0.65 0.18 160)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ema12"
                    stroke="oklch(0.78 0.18 75)"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="ema26"
                    stroke="oklch(0.70 0.16 320)"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Indicators */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-300" />
              Indicators
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!indicators ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {scanQ.data?.message ?? 'Indicators require ≥30 klines.'}
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <IndTile label="RSI 14" value={indicators.rsi14?.toFixed(1) ?? '—'} hint={rsiHint(indicators.rsi14)} />
                  <IndTile label="MACD" value={indicators.macd.macd?.toFixed(2) ?? '—'} />
                  <IndTile label="Signal" value={indicators.macd.signal?.toFixed(2) ?? '—'} />
                  <IndTile
                    label="Histogram"
                    value={indicators.macd.histogram?.toFixed(2) ?? '—'}
                    tone={
                      indicators.macd.histogram != null && indicators.macd.histogram >= 0
                        ? 'emerald'
                        : 'rose'
                    }
                  />
                  <IndTile label="BB Upper" value={fmtPrice(indicators.bollinger.upper, quote?.currency)} />
                  <IndTile label="BB Lower" value={fmtPrice(indicators.bollinger.lower, quote?.currency)} />
                  <IndTile label="VWAP" value={fmtPrice(indicators.vwap, quote?.currency)} />
                  <IndTile
                    label="Trend"
                    value={indicators.trend}
                    tone={indicators.trend === 'up' ? 'emerald' : indicators.trend === 'down' ? 'rose' : 'muted'}
                  />
                </div>

                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    5-Indicator Vote
                  </div>
                  <div className="flex gap-1">
                    {(['rsi', 'macd', 'ema', 'bollinger', 'vwap'] as const).map((k) => {
                      const v = indicators.votes[k];
                      return (
                        <div
                          key={k}
                          className={cn(
                            'flex flex-1 items-center justify-center rounded-md border px-1 py-1.5 text-[10px] font-mono uppercase',
                            v > 0
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : v < 0
                                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                : 'border-border bg-muted/30 text-muted-foreground',
                          )}
                        >
                          {k} {v > 0 ? '+1' : v < 0 ? '-1' : '0'}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Summary:</span>{' '}
                  {indicators.summaryScore > 0 ? 'Bullish' : indicators.summaryScore < 0 ? 'Bearish' : 'Neutral'} ·{' '}
                  score {indicators.summaryScore}/100 · trend {indicators.trend}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* News panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-sky-300" />
            News &amp; Sentiment
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Recent Headlines
              </div>
              <p className="text-[11px] text-muted-foreground">
                No tagged news in the local DB for {symbol}. Connect a news source
                (Reddit, CryptoPanic, RSS) via the Settings page to populate this panel.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Sentiment Summary
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className={cn(
                    'text-xl font-bold',
                    positive ? 'text-emerald-300' : 'text-rose-300',
                  )}
                >
                  {positive ? '+' : ''}
                  {(quote?.changePercent ?? 0).toFixed(2)}%
                </span>
                <span className="text-[10px] text-muted-foreground">market-implied 24h</span>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Price action is the most reliable sentiment proxy when no news feed is configured.
                Use the Reddit sentiment panel on the Lazy Brain page for community-sourced signals.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'rose' | 'sky' | 'amber' | 'muted';
}): React.ReactElement {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-300 border-emerald-500/30'
      : tone === 'rose'
        ? 'text-rose-300 border-rose-500/30'
        : tone === 'sky'
          ? 'text-sky-300 border-sky-500/30'
          : tone === 'amber'
            ? 'text-amber-300 border-amber-500/30'
            : 'text-muted-foreground border-border';
  return (
    <Card className={cn('p-3', toneClass)}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={toneClass.split(' ')[0]}>{icon}</span>
      </div>
      <div className="mt-1 text-lg font-bold text-foreground">{value}</div>
    </Card>
  );
}

function IndTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'emerald' | 'rose' | 'muted';
}): React.ReactElement {
  const toneClass =
    tone === 'emerald'
      ? 'text-emerald-300'
      : tone === 'rose'
        ? 'text-rose-300'
        : 'text-foreground';
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-xs', toneClass)}>{value}</div>
      {hint ? <div className="text-[9px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
