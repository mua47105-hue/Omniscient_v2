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
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
} from 'recharts';
import {
  ArrowLeft,
  Activity,
  BookOpen,
  Gauge,
  Layers,
  TrendingUp,
  TrendingDown,
  DollarSign,
  RefreshCw,
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

interface KlinesEnvelope {
  success?: boolean;
  data?: KlineLite[];
}

interface OrderBookLite {
  symbol: string;
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  fetchedAt: number;
}

interface OrderBookEnvelope {
  success?: boolean;
  data?: OrderBookLite;
}

interface TickerLite {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  high: number;
  low: number;
  quoteVolume: number;
}

interface TickerEnvelope {
  success?: boolean;
  data?: TickerLite;
}

interface FundingLite {
  symbol: string;
  fundingRate: number;
  markPrice?: number;
  nextFundingTime?: number;
}

interface FundingEnvelope {
  success?: boolean;
  data?: FundingLite;
}

// ---------------------------------------------------------------------------
// Indicator computation (mirror of lib/analysis/indicators — but lightweight,
// client-side, only what the asset detail page needs)
// ---------------------------------------------------------------------------

interface LocalIndicators {
  rsi14: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  vwap: number | null;
  atr14: number | null;
  trend: 'up' | 'down' | 'sideways';
  votes: { rsi: number; macd: number; ema: number; bb: number; vwap: number };
  summaryScore: number;
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macdCalc(values: number[]) {
  if (values.length < 26) return { macd: null, signal: null, hist: null };
  const emaFast = emaSeries(values, 12);
  const emaSlow = emaSeries(values, 26);
  const offset = emaFast.length - emaSlow.length;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }
  const signalLine = emaSeries(macdLine, 9);
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalLine.length ? signalLine[signalLine.length - 1] : null;
  const hist = macdVal != null && signalVal != null ? macdVal - signalVal : null;
  return { macd: macdVal, signal: signalVal, hist };
}

function bollinger(values: number[], period = 20, mult = 2) {
  if (values.length < period) return { upper: null, middle: null, lower: null };
  const slice = values.slice(values.length - period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + mult * sd, middle: mean, lower: mean - mult * sd };
}

function vwapCalc(highs: number[], lows: number[], closes: number[], vols: number[]): number | null {
  const n = Math.min(highs.length, lows.length, closes.length, vols.length);
  if (n === 0) return null;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    pv += tp * vols[i];
    vol += vols[i];
  }
  return vol === 0 ? null : pv / vol;
}

function computeLocalIndicators(klines: KlineLite[]): LocalIndicators | null {
  if (klines.length < 30) return null;
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const vols = klines.map((k) => k.volume);

  const rsi14 = rsi(closes, 14);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const m = macdCalc(closes);
  const bb = bollinger(closes, 20, 2);
  const vwapVal = vwapCalc(highs, lows, closes, vols);

  const lastClose = closes[closes.length - 1];
  const last20 = closes.slice(-20);
  const slope = (last20[last20.length - 1] - last20[0]) / last20[0];
  let trend: 'up' | 'down' | 'sideways' = 'sideways';
  if (ema12 != null && ema26 != null) {
    if (ema12 > ema26 && slope > 0.005) trend = 'up';
    else if (ema12 < ema26 && slope < -0.005) trend = 'down';
  }

  const vRsi = rsi14 == null ? 0 : rsi14 > 55 ? 1 : rsi14 < 45 ? -1 : 0;
  const vMacd = m.hist == null ? 0 : m.hist > 0 ? 1 : m.hist < 0 ? -1 : 0;
  const vEma = ema12 == null || ema26 == null ? 0 : ema12 > ema26 ? 1 : ema12 < ema26 ? -1 : 0;
  const vBb = lastClose == null || bb.middle == null ? 0 : lastClose > bb.middle ? 1 : lastClose < bb.middle ? -1 : 0;
  const vVwap = lastClose == null || vwapVal == null ? 0 : lastClose > vwapVal ? 1 : lastClose < vwapVal ? -1 : 0;
  const voteSum = vRsi + vMacd + vEma + vBb + vVwap;
  const summaryScore = Math.max(-100, Math.min(100, voteSum * 20));

  return {
    rsi14,
    ema12,
    ema26,
    macd: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    bbUpper: bb.upper,
    bbMiddle: bb.middle,
    bbLower: bb.lower,
    vwap: vwapVal,
    atr14: null,
    trend,
    votes: { rsi: vRsi, macd: vMacd, ema: vEma, bb: vBb, vwap: vVwap },
    summaryScore,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toFixed(6);
}

function fmtVol(n?: number): string {
  if (!n || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CryptoAssetClientProps {
  symbol: string;
}

export function CryptoAssetClient({ symbol }: CryptoAssetClientProps): React.ReactElement {
  // Normalize: accept "BTC", "BTCUSDT", "btc".
  const base = symbol.replace(/USDT$/i, '').toUpperCase();
  const binanceSymbol = `${base}USDT`;

  const klinesQ = useQuery<KlineLite[]>({
    queryKey: ['crypto-klines', binanceSymbol, '4h', 200],
    queryFn: async () => {
      const res = await fetch(
        `/api/crypto/klines?symbol=${binanceSymbol}&interval=4h&limit=200`,
      );
      if (!res.ok) throw new Error('klines fetch failed');
      const json: KlinesEnvelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const tickerQ = useQuery<TickerLite>({
    queryKey: ['crypto-ticker', binanceSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/crypto/prices`);
      if (!res.ok) throw new Error('prices fetch failed');
      const json: TickerEnvelope = await res.json();
      const arr = (json as unknown as { data?: TickerLite[] }).data ?? [];
      const found = arr.find((t) => t.symbol === binanceSymbol);
      if (!found) throw new Error(`no ticker for ${binanceSymbol}`);
      return found;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const obQ = useQuery<OrderBookLite>({
    queryKey: ['crypto-orderbook', binanceSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/crypto/orderbook?symbol=${binanceSymbol}&limit=50`);
      if (!res.ok) throw new Error('orderbook fetch failed');
      const json: OrderBookEnvelope = await res.json();
      if (!json.data) throw new Error('empty orderbook');
      return json.data;
    },
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // Funding — use the bulk endpoint so we don't have to add a per-symbol route.
  const fundingQ = useQuery<FundingLite | null>({
    queryKey: ['crypto-funding', binanceSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/derivatives/funding-all`);
      if (!res.ok) throw new Error('funding fetch failed');
      const json: { success?: boolean; data?: FundingLite[] } = await res.json();
      const list = json.data ?? [];
      return list.find((f) => f.symbol === binanceSymbol) ?? null;
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const klines = klinesQ.data ?? [];
  const indicators = React.useMemo(() => computeLocalIndicators(klines), [klines]);

  const chartData = React.useMemo(
    () =>
      klines.map((k) => ({
        time: new Date(k.openTime).toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        }),
        close: k.close,
        volume: k.volume,
        high: k.high,
        low: k.low,
        bbUpper: indicators?.bbUpper ?? null,
        bbMiddle: indicators?.bbMiddle ?? null,
        bbLower: indicators?.bbLower ?? null,
      })),
    [klines, indicators],
  );

  const ticker = tickerQ.data;
  const ob = obQ.data;
  const funding = fundingQ.data ?? undefined;

  const positive = (ticker?.priceChangePercent ?? 0) >= 0;

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/crypto">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {base}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/USDT</span>
              </h1>
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
            <p className="text-xs text-muted-foreground">
              {binanceSymbol} · Binance Perpetual · 4h klines
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="font-mono text-2xl font-bold text-foreground">
              ${fmtPrice(ticker?.lastPrice)}
            </div>
            <div
              className={cn(
                'font-mono text-xs',
                positive ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {positive ? '+' : ''}
              {ticker?.priceChangePercent.toFixed(2)}% 24h
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void klinesQ.refetch();
              void obQ.refetch();
              void tickerQ.refetch();
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', klinesQ.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="24h High" value={`$${fmtPrice(ticker?.high)}`} icon={<TrendingUp className="h-3 w-3" />} tone="emerald" />
        <StatTile label="24h Low" value={`$${fmtPrice(ticker?.low)}`} icon={<TrendingDown className="h-3 w-3" />} tone="rose" />
        <StatTile label="24h Volume" value={fmtVol(ticker?.quoteVolume)} icon={<Activity className="h-3 w-3" />} tone="sky" />
        <StatTile
          label="Funding"
          value={funding ? `${(funding.fundingRate * 100).toFixed(4)}%` : '—'}
          icon={<DollarSign className="h-3 w-3" />}
          tone={
            funding ? (funding.fundingRate >= 0 ? 'amber' : 'sky') : 'muted'
          }
        />
      </div>

      {/* Price chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Price Chart (4h) · Bollinger Bands overlay
          </CardTitle>
        </CardHeader>
        <CardContent>
          {klinesQ.isLoading ? (
            <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
              Loading klines…
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
              No kline data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <defs>
                  <linearGradient id="price-area" x1="0" y1="0" x2="0" y2="1">
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
                  minTickGap={40}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={(v: number) => fmtPrice(v)}
                  orientation="right"
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
                  formatter={(v: number, n: string) => [`$${fmtPrice(v)}`, n]}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="oklch(0.72 0.18 256)"
                  strokeWidth={1.6}
                  fill="url(#price-area)"
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
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Indicators + Order book row */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Indicator panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-300" />
              Indicators (5-vote consensus)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!indicators ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Indicators require ≥30 klines.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <IndTile label="RSI 14" value={indicators.rsi14?.toFixed(1) ?? '—'} hint={rsiHint(indicators.rsi14)} />
                  <IndTile label="EMA 12" value={`$${fmtPrice(indicators.ema12)}`} />
                  <IndTile label="EMA 26" value={`$${fmtPrice(indicators.ema26)}`} />
                  <IndTile label="MACD" value={fmtPrice(indicators.macd)} />
                  <IndTile label="Signal" value={fmtPrice(indicators.macdSignal)} />
                  <IndTile label="Hist" value={fmtPrice(indicators.macdHist)} tone={indicators.macdHist != null && indicators.macdHist >= 0 ? 'emerald' : 'rose'} />
                  <IndTile label="BB Upper" value={`$${fmtPrice(indicators.bbUpper)}`} />
                  <IndTile label="BB Mid" value={`$${fmtPrice(indicators.bbMiddle)}`} />
                  <IndTile label="BB Lower" value={`$${fmtPrice(indicators.bbLower)}`} />
                  <IndTile label="VWAP" value={`$${fmtPrice(indicators.vwap)}`} />
                  <IndTile label="Trend" value={indicators.trend} tone={indicators.trend === 'up' ? 'emerald' : indicators.trend === 'down' ? 'rose' : 'muted'} />
                  <IndTile label="Score" value={`${indicators.summaryScore}`} tone={indicators.summaryScore > 0 ? 'emerald' : indicators.summaryScore < 0 ? 'rose' : 'muted'} />
                </div>

                {/* Vote bar */}
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    5-Indicator Vote
                  </div>
                  <div className="flex gap-1">
                    {(['rsi', 'macd', 'ema', 'bb', 'vwap'] as const).map((k) => {
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

        {/* Order book */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-sky-300" />
                Order Book Depth
              </span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {ob ? `${ob.bids.length + ob.asks.length} levels` : '—'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!ob ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading order book…</p>
            ) : (
              <OrderBookDepth bids={ob.bids} asks={ob.asks} lastPrice={ticker?.lastPrice} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Volume bars */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-violet-300" />
            Volume (4h bars)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No volume data</p>
          ) : (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chartData} margin={{ top: 4, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.014 264 / 0.4)" />
                <XAxis
                  dataKey="time"
                  tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fill: 'oklch(0.70 0.012 264)', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  orientation="right"
                  tickFormatter={(v: number) => fmtVol(v)}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'oklch(0.20 0.014 264)',
                    border: '1px solid oklch(0.30 0.014 264 / 0.7)',
                    borderRadius: '8px',
                    fontSize: '11px',
                    color: 'oklch(0.97 0.005 264)',
                  }}
                  formatter={(v: number) => [fmtVol(v), 'Volume']}
                />
                <ReferenceLine y={0} stroke="oklch(0.30 0.014 264)" />
                <Bar dataKey="volume" isAnimationActive={false}>
                  {chartData.map((d, i) => {
                    const prev = i > 0 ? chartData[i - 1].close : d.close;
                    const up = d.close >= prev;
                    return (
                      <Cell
                        key={i}
                        fill={up ? 'oklch(0.72 0.18 160 / 0.55)' : 'oklch(0.65 0.22 25 / 0.55)'}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Funding + Deep analysis footer */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-amber-300" />
            Funding &amp; Deep Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 text-xs">
            <Row label="Symbol" value={binanceSymbol} />
            <Row
              label="Funding Rate"
              value={funding ? `${(funding.fundingRate * 100).toFixed(4)}%` : '—'}
              tone={
                funding
                  ? funding.fundingRate > 0
                    ? 'longs pay shorts (bullish leveraged)'
                    : funding.fundingRate < 0
                      ? 'shorts pay longs (bearish leveraged)'
                      : 'neutral'
                  : '—'
              }
            />
            <Row label="Mark Price" value={funding?.markPrice ? `$${fmtPrice(funding.markPrice)}` : '—'} />
            <Row label="Next Funding" value={funding?.nextFundingTime ? fmtTime(funding.nextFundingTime) : '—'} />
            <Row label="Last Price" value={ticker ? `$${fmtPrice(ticker.lastPrice)}` : '—'} />
          </div>
          <div className="space-y-2 text-xs">
            <Row label="RSI 14" value={indicators?.rsi14?.toFixed(1) ?? '—'} tone={indicators ? rsiHint(indicators.rsi14) : '—'} />
            <Row label="Trend" value={indicators?.trend ?? '—'} tone={indicators?.trend ?? '—'} />
            <Row label="MACD Hist" value={indicators?.macdHist?.toFixed(2) ?? '—'} tone={indicators?.macdHist != null ? (indicators.macdHist >= 0 ? 'bullish' : 'bearish') : '—'} />
            <Row label="EMA Cross" value={indicators ? (indicators.ema12 != null && indicators.ema26 != null ? (indicators.ema12 > indicators.ema26 ? 'bullish (12>26)' : 'bearish (12<26)') : '—') : '—'} />
            <Row label="Summary Score" value={indicators ? `${indicators.summaryScore}/100` : '—'} tone={indicators ? (indicators.summaryScore > 0 ? 'bullish' : indicators.summaryScore < 0 ? 'bearish' : 'neutral') : '—'} />
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

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
      {tone ? <span className="ml-2 text-[10px] text-muted-foreground/70">· {tone}</span> : null}
    </div>
  );
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
// Order book depth visualization (horizontal bid/ask ladder)
// ---------------------------------------------------------------------------

function OrderBookDepth({
  bids,
  asks,
  lastPrice,
}: {
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  lastPrice?: number;
}): React.ReactElement {
  const topBids = bids.slice(0, 10).reverse();
  const topAsks = asks.slice(0, 10);
  const maxQty = Math.max(
    1,
    ...topBids.map((b) => b.quantity),
    ...topAsks.map((a) => a.quantity),
  );

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Price (Bid)</span>
        <span className="text-center">Qty</span>
        <span className="text-right">Price (Ask)</span>
      </div>
      <div className="space-y-0.5">
        {Array.from({ length: 10 }).map((_, i) => {
          const bid = topBids[i];
          const ask = topAsks[i];
          return (
            <div key={i} className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="relative overflow-hidden rounded-sm px-1.5 py-0.5">
                {bid ? (
                  <>
                    <div
                      className="absolute inset-y-0 right-0 bg-emerald-500/15"
                      style={{ width: `${(bid.quantity / maxQty) * 100}%` }}
                    />
                    <span className="relative font-mono text-emerald-300">
                      {fmtPrice(bid.price)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div className="px-1.5 py-0.5 text-center font-mono text-muted-foreground">
                {bid ? bid.quantity.toFixed(3) : '—'}
                {ask ? ` / ${ask.quantity.toFixed(3)}` : ''}
              </div>
              <div className="relative overflow-hidden rounded-sm px-1.5 py-0.5 text-right">
                {ask ? (
                  <>
                    <div
                      className="absolute inset-y-0 left-0 bg-rose-500/15"
                      style={{ width: `${(ask.quantity / maxQty) * 100}%` }}
                    />
                    <span className="relative font-mono text-rose-300">
                      {fmtPrice(ask.price)}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {lastPrice != null ? (
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
          <span className="text-muted-foreground">Last Price</span>
          <span className="font-mono font-bold text-foreground">${fmtPrice(lastPrice)}</span>
        </div>
      ) : null}
    </div>
  );
}
