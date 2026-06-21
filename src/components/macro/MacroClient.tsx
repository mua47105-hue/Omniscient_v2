'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Globe2,
  TrendingUp,
  TrendingDown,
  Activity,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

interface YahooQuote {
  symbol: string;
  price: number;
  change?: number;
  changePercent?: number;
  previousClose?: number;
  currency?: string;
  fetchedAt: number;
}

interface FearGreedEntry {
  value: number;
  classification: string;
  timestamp: number;
}

interface MacroResponse {
  success?: boolean;
  data?: {
    quotes: YahooQuote[];
    fearGreed: FearGreedEntry | null;
    regime: 'risk-on' | 'risk-off' | 'neutral';
    symbols: Array<{ symbol: string; label: string; yahoo: string }>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

function fgColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v < 25) return 'text-rose-400';
  if (v < 45) return 'text-orange-400';
  if (v < 55) return 'text-amber-300';
  if (v < 75) return 'text-lime-300';
  return 'text-emerald-400';
}

function regimeMeta(regime: string): {
  label: string;
  variant: 'success' | 'rose' | 'warning';
  icon: React.ReactNode;
} {
  switch (regime) {
    case 'risk-on':
      return {
        label: 'Risk-On',
        variant: 'success',
        icon: <TrendingUp className="h-3.5 w-3.5" />,
      };
    case 'risk-off':
      return {
        label: 'Risk-Off',
        variant: 'rose',
        icon: <TrendingDown className="h-3.5 w-3.5" />,
      };
    default:
      return {
        label: 'Neutral',
        variant: 'warning',
        icon: <Activity className="h-3.5 w-3.5" />,
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MacroClient(): React.ReactElement {
  const q = useQuery<MacroResponse>({
    queryKey: ['macro-quotes'],
    queryFn: async () => {
      const res = await fetch('/api/macro/quotes');
      if (!res.ok) throw new Error('macro fetch failed');
      return res.json();
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const data = q.data?.data;
  const quotes = data?.quotes ?? [];
  const fg = data?.fearGreed;
  const regime = data?.regime ?? 'neutral';
  const symbols = data?.symbols ?? [];
  const regMeta = regimeMeta(regime);

  // Fear & greed history (single point — for the chart we synthesize a flat line)
  const fgData = fg ? [{ t: fg.timestamp * 1000, v: fg.value }] : [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Macro</h1>
          <p className="text-xs text-muted-foreground">
            DXY, VIX, Gold, Oil, S&amp;P500, Nasdaq, US10Y, Fear &amp; Greed. Regime detection
            updates every 2 minutes.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Regime</span>
          <Badge variant={regMeta.variant} className="gap-1">
            {regMeta.icon}
            {regMeta.label}
          </Badge>
        </div>
      </div>

      {/* Regime + Fear & Greed banner */}
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-950/20 to-card">
        <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Fear &amp; Greed
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={cn('text-2xl font-bold', fgColor(fg?.value))}>
                {fg?.value ?? '—'}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {fg?.classification ?? 'awaiting'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Regime
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {regMeta.icon}
              <span className="text-base font-semibold text-foreground">{regMeta.label}</span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Quotes
            </div>
            <div className="mt-1 font-mono text-base text-foreground">{quotes.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[11px] text-muted-foreground">
                {q.isLoading ? 'Loading…' : 'Live'}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-6 text-center text-xs text-muted-foreground">
            Loading macro quotes…
          </CardContent>
        </Card>
      ) : quotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Globe2 className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              Yahoo Finance may be unreachable. Retry in a moment.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Quote cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {symbols.map((sym) => {
              const quote = quotes.find((q) => q.symbol === sym.yahoo);
              if (!quote) {
                return (
                  <Card key={sym.symbol} className="p-4 ring-1 ring-inset ring-border/30">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {sym.label}
                    </div>
                    <div className="mt-2 text-2xl font-bold text-muted-foreground">—</div>
                  </Card>
                );
              }
              const positive = (quote.changePercent ?? 0) >= 0;
              return (
                <Card
                  key={sym.symbol}
                  className={cn(
                    'p-4 ring-1 ring-inset ring-border/30',
                    positive ? 'border-emerald-500/20' : 'border-rose-500/20',
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {sym.label}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {sym.symbol}
                      </span>
                    </div>
                    {positive ? (
                      <TrendingUp className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-rose-300" />
                    )}
                  </div>
                  <div className="mt-2 text-2xl font-bold text-foreground">
                    {fmtPrice(quote.price)}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    <span
                      className={cn(
                        'font-mono',
                        positive ? 'text-emerald-400' : 'text-rose-400',
                      )}
                    >
                      {fmtPct(quote.changePercent)}
                    </span>
                    <span className="text-muted-foreground">prev {fmtPrice(quote.previousClose)}</span>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Regime explanation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-300" />
                Regime Detection Logic
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-rose-400">●</span>
                <span>
                  <span className="font-semibold text-rose-300">Risk-Off</span> when VIX ≥ 25 or
                  DXY 1-day change &gt; +0.3%. Capital rotates to safe havens (USD, gold, bonds).
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-emerald-400">●</span>
                <span>
                  <span className="font-semibold text-emerald-300">Risk-On</span> when VIX &lt; 18
                  or DXY 1-day change &lt; -0.3%. Capital rotates to risk assets (equities, crypto,
                  commodities).
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 text-amber-400">●</span>
                <span>
                  <span className="font-semibold text-amber-300">Neutral</span> otherwise. Mixed
                  signals — no strong directional bias.
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Fear & Greed chart */}
          {fg && fgData.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Fear &amp; Greed Index</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-32 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={fgData}>
                      <defs>
                        <linearGradient id="fg-gradient" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.72 0.18 160)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="oklch(0.72 0.18 160)" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                      <XAxis
                        dataKey="t"
                        tickFormatter={(t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                      />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                        stroke="oklch(0.30 0.014 264)"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'oklch(0.20 0.014 264)',
                          border: '1px solid oklch(0.30 0.014 264)',
                          borderRadius: 6,
                          fontSize: 12,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="v"
                        stroke="oklch(0.72 0.18 160)"
                        strokeWidth={2}
                        fill="url(#fg-gradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
