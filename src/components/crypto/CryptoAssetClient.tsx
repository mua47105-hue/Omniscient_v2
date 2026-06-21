'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  AlertCircle,
  Sparkles,
  Loader2,
  RefreshCw,
  Activity,
  BookOpen,
  Flame,
  Layers as LayersIcon,
  Target,
  ShieldAlert,
  Clock,
  TrendingUp,
  ChevronLeft,
} from 'lucide-react';
import Link from 'next/link';
import type { Kline, TechnicalIndicators, ConsensusResult, LayerScore, Ticker, ApiResult } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useLiveTicker } from '@/hooks/useLiveTicker';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j: ApiResult<T> = await r.json();
  if (!j.success) throw new Error(j.error || 'request failed');
  return j.data as T;
}

function fmtPrice(p?: number): string {
  if (p == null || Number.isNaN(p)) return '—';
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

function fmtVol(v?: number): string {
  if (!v) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function computeEma(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
    } else if (i === period - 1) {
      const sma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      prev = sma;
      out.push(sma);
    } else {
      prev = values[i] * k + (prev as number) * (1 - k);
      out.push(prev);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// main client
// ---------------------------------------------------------------------------

type Interval = '1h' | '4h' | '1d';

interface OrderbookData {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  spread: number;
  bidDepth: number;
  askDepth: number;
  imbalance: number;
  funding: { rate: number; nextFunding: number } | null;
  openInterest: { openInterest: number; value: number } | null;
}

interface SignalRow {
  id: string;
  direction: 'long' | 'short' | 'neutral';
  conviction: number;
  timeframe: string;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  rationale: string;
  timestamp: string;
  asset?: { symbol: string } | null;
}

export function CryptoAssetClient({ symbol }: { symbol: string }) {
  const [tf, setTf] = useState<Interval>('4h');

  // Live ticker (24h stats) — refresh every 15s
  const priceQ = useQuery({
    queryKey: ['crypto-price', symbol],
    queryFn: async () => {
      const all = await fetchJson<Ticker[]>('/api/crypto/prices');
      return all.find((t) => t.symbol === symbol) ?? null;
    },
    refetchInterval: 15_000,
  });

  // Klines + indicators — refresh every 30s, depends on tf
  const klinesQ = useQuery({
    queryKey: ['crypto-klines', symbol, tf],
    queryFn: () =>
      fetchJson<{ klines: Kline[]; indicators: TechnicalIndicators }>(
        `/api/crypto/klines?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=200`
      ),
    refetchInterval: 30_000,
  });

  // Order book + funding + OI — refresh every 15s
  const obQ = useQuery({
    queryKey: ['crypto-orderbook', symbol],
    queryFn: () => fetchJson<OrderbookData>(`/api/crypto/orderbook?symbol=${encodeURIComponent(symbol)}`),
    refetchInterval: 15_000,
  });

  // Real-time WebSocket ticker (Binance combined stream). Only subscribe for
  // USDT-quoted pairs that Binance actually streams.
  const isBinancePair = symbol.endsWith('USDT');
  const liveFeed = useLiveTicker(isBinancePair ? [symbol] : []);
  const liveTicker = liveFeed.tickers[symbol];
  const liveStatus = liveFeed.status;

  const ticker = liveTicker ?? priceQ.data;
  const klines = klinesQ.data?.klines ?? [];
  const indicators = klinesQ.data?.indicators;
  const ob = obQ.data;

  // Derived live price — fall back to latest kline close if neither source has loaded yet
  const livePrice = ticker?.price ?? klines[klines.length - 1]?.close;
  const changePct = ticker?.changePct;
  const isUp = (changePct ?? 0) >= 0;

  const base = symbol.replace(/USDT$/, '');
  const quote = symbol.endsWith('USDT') ? 'USDT' : '';

  // Build chart data + EMA series
  const closes = klines.map((k) => k.close);
  const ema20Series = computeEma(closes, 20);
  const ema50Series = computeEma(closes, 50);
  const chartData = klines.map((k, i) => ({
    t: fmtTime(k.openTime),
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    ema20: ema20Series[i],
    ema50: ema50Series[i],
    volume: k.volume,
    isUp: k.close >= k.open,
  }));

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Link
        href="/crypto"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Crypto Markets
      </Link>

      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {base} <span className="text-muted-foreground font-normal">/ {quote}</span>
            </h1>
            <Badge variant="outline" className="text-xs">
              {symbol}
            </Badge>
            {isBinancePair && <LiveBadge status={liveStatus} />}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <LivePrice price={livePrice} />
            {changePct != null && (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 text-sm font-semibold',
                  isUp ? 'text-emerald-500' : 'text-rose-500'
                )}
              >
                {isUp ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                {isUp ? '+' : ''}
                {changePct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Stat label="24h High" value={ticker ? fmtPrice(ticker.high) : '—'} />
          <Stat label="24h Low" value={ticker ? fmtPrice(ticker.low) : '—'} />
          <Stat label="24h Vol" value={ticker ? fmtVol(ticker.quoteVolume) : '—'} />
          {/* Interval selector */}
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
            {(['1h', '4h', '1d'] as Interval[]).map((opt) => (
              <button
                key={opt}
                onClick={() => setTf(opt)}
                className={cn(
                  'px-3 py-1 text-xs font-semibold rounded transition-colors',
                  tf === opt ? 'bg-emerald-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Main grid */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left column (2/3) */}
        <div className="lg:col-span-2 space-y-5">
          <PriceChartCard
            data={chartData}
            loading={klinesQ.isLoading && klines.length === 0}
            error={klinesQ.isError && klines.length === 0}
            tf={tf}
          />
          {indicators && <IndicatorsCard indicators={indicators} />}
        </div>

        {/* Right column (1/3) */}
        <div className="space-y-5">
          <OrderBookCard data={ob} loading={obQ.isLoading && !ob} error={obQ.isError && !ob} />
          <FundingOICard data={ob} price={livePrice} />
          <DeepAnalysisCard symbol={symbol} tf={tf} />
        </div>
      </div>

      {/* Recent signals */}
      <RecentSignals symbol={symbol} />

      {/* Refresh hint */}
      <div className="text-center text-[11px] text-muted-foreground pb-2">
        <Clock className="inline h-3 w-3 mr-1" />
        {isBinancePair && liveStatus === 'connected'
          ? `Price streaming live via WebSocket · Order book refreshes every 15s · Klines every 30s · Interval: ${tf}`
          : `Price & order book refresh every 15s · Klines every 30s · Interval: ${tf}`}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// live status badge (top bar)
// ---------------------------------------------------------------------------

function LiveBadge({ status }: { status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' }) {
  const cfg = {
    connected: {
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-500',
      dot: 'bg-emerald-500',
      ring: 'bg-emerald-400',
      label: 'Live',
      ping: true,
    },
    reconnecting: {
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
      text: 'text-amber-500',
      dot: 'bg-amber-500',
      ring: 'bg-amber-400',
      label: 'Reconnecting',
      ping: true,
    },
    connecting: {
      border: 'border-amber-500/30',
      bg: 'bg-amber-500/10',
      text: 'text-amber-500',
      dot: 'bg-amber-500',
      ring: 'bg-amber-400',
      label: 'Connecting',
      ping: true,
    },
    disconnected: {
      border: 'border-rose-500/30',
      bg: 'bg-rose-500/10',
      text: 'text-rose-500',
      dot: 'bg-rose-500',
      ring: 'bg-rose-400',
      label: 'Offline',
      ping: false,
    },
  }[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        cfg.border,
        cfg.bg,
        cfg.text
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        {cfg.ping && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', cfg.ring)} />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', cfg.dot)} />
      </span>
      {cfg.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// live price with flash-on-tick animation
// ---------------------------------------------------------------------------

function LivePrice({ price }: { price: number | undefined }) {
  // Track the previous price in a ref (updated inside an effect) and trigger
  // a brief background-color flash on each tick. setState is called from a
  // setTimeout callback (not synchronously in the effect body) so it doesn't
  // trip the set-state-in-effect rule.
  const prevPriceRef = useRef<number | undefined>(price);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price == null) return;
    const prev = prevPriceRef.current;
    if (prev != null && price !== prev) {
      const dir: 'up' | 'down' = price > prev ? 'up' : 'down';
      const t1 = setTimeout(() => setFlash(dir), 0);
      const t2 = setTimeout(() => setFlash(null), 600);
      prevPriceRef.current = price;
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    prevPriceRef.current = price;
  }, [price]);

  return (
    <motion.span
      key={price ?? 'no-data'}
      initial={
        flash === 'up'
          ? { backgroundColor: 'rgba(16,185,129,0.18)' }
          : flash === 'down'
          ? { backgroundColor: 'rgba(244,63,94,0.18)' }
          : false
      }
      animate={{ backgroundColor: 'rgba(0,0,0,0)' }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="text-3xl md:text-4xl font-mono font-bold tabular-nums rounded px-1 -mx-1"
    >
      {price != null ? `$${fmtPrice(price)}` : '—'}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// small stat (top bar)
// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-mono tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price chart card
// ---------------------------------------------------------------------------

interface ChartDatum {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number | null;
  ema50: number | null;
  volume: number;
  isUp: boolean;
}

function PriceChartCard({
  data,
  loading,
  error,
  tf,
}: {
  data: ChartDatum[];
  loading: boolean;
  error: boolean;
  tf: Interval;
}) {
  const maxVol = data.length ? Math.max(...data.map((d) => d.volume)) : 1;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" /> Price Chart
          </span>
          <div className="flex items-center gap-3 text-[11px] font-normal">
            <span className="flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-emerald-500" /> Close
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-amber-500" /> EMA20
            </span>
            <span className="flex items-center gap-1">
              <span className="h-0.5 w-3 bg-rose-500" /> EMA50
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[360px] w-full" />
        ) : error ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-rose-500 gap-2">
            <AlertCircle className="h-4 w-4" /> Failed to load chart data
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
            No data
          </div>
        ) : (
          <div className="h-[360px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  stroke="hsl(var(--border))"
                  minTickGap={50}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="price"
                  orientation="right"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  stroke="hsl(var(--border))"
                  width={62}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => fmtPrice(v)}
                  tickLine={false}
                />
                <YAxis yAxisId="vol" orientation="left" hide domain={[0, maxVol * 5]} />
                <Tooltip content={<ChartTooltip />} />
                <Bar yAxisId="vol" dataKey="volume" fill="#10b981" opacity={0.18} isAnimationActive={false} />
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="close"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#priceGrad)"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="ema20"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  isAnimationActive={false}
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="ema50"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                  isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted-foreground">
          {data.length} candles · {tf} timeframe · EMA20 / EMA50 overlay
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d: ChartDatum = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-popover/95 backdrop-blur p-2.5 text-xs shadow-xl min-w-[180px]">
      <div className="text-muted-foreground mb-1.5 font-medium">{d.t}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <TipRow label="O" value={fmtPrice(d.open)} />
        <TipRow label="H" value={fmtPrice(d.high)} />
        <TipRow label="L" value={fmtPrice(d.low)} />
        <TipRow label="C" value={fmtPrice(d.close)} accent={d.isUp ? 'emerald' : 'rose'} />
      </div>
      <div className="border-t border-border mt-1.5 pt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono tabular-nums">
        <TipRow label="EMA20" value={d.ema20 != null ? fmtPrice(d.ema20) : '—'} color="#f59e0b" />
        <TipRow label="EMA50" value={d.ema50 != null ? fmtPrice(d.ema50) : '—'} color="#f43f5e" />
        <TipRow label="Vol" value={d.volume.toLocaleString('en-US', { maximumFractionDigits: 0 })} />
      </div>
    </div>
  );
}

function TipRow({
  label,
  value,
  color,
  accent,
}: {
  label: string;
  value: string;
  color?: string;
  accent?: 'emerald' | 'rose';
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground" style={color ? { color } : undefined}>
        {label}
      </span>
      <span
        className={cn(
          accent === 'emerald' && 'text-emerald-500',
          accent === 'rose' && 'text-rose-500'
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicators card
// ---------------------------------------------------------------------------

function IndicatorsCard({ indicators }: { indicators: TechnicalIndicators }) {
  const rsi = indicators.rsi;
  const rsiColor = rsi > 70 ? 'text-rose-500' : rsi < 30 ? 'text-emerald-500' : 'text-foreground';
  const macdHist = indicators.macd.histogram;
  const macdColor = macdHist > 0 ? 'text-emerald-500' : 'text-rose-500';
  const trendCfg = {
    bullish: { label: 'Bullish', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    bearish: { label: 'Bearish', className: 'bg-rose-500/15 text-rose-500 border-rose-500/30' },
    neutral: { label: 'Neutral', className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
  }[indicators.trend];

  const score = indicators.summary.score;
  const scoreColor = score > 15 ? 'text-emerald-500' : score < -15 ? 'text-rose-500' : 'text-amber-500';
  const scorePos = (score + 100) / 2; // 0..100

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LayersIcon className="h-4 w-4 text-emerald-500" /> Technical Indicators
        </CardTitle>
        <CardDescription className="text-xs">Computed from latest 200 klines · {indicators.trend} bias</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Tile label="RSI (14)" value={rsi.toFixed(1)} valueClassName={rsiColor} hint={rsi > 70 ? 'overbought' : rsi < 30 ? 'oversold' : undefined} />
          <Tile label="MACD Hist" value={macdHist.toFixed(3)} valueClassName={macdColor} />
          <Tile label="Trend" value={trendCfg.label} badgeClassName={trendCfg.className} />
          <Tile label="EMA 20" value={fmtPrice(indicators.ema20)} />
          <Tile label="EMA 50" value={fmtPrice(indicators.ema50)} />
          <Tile label="EMA 200" value={fmtPrice(indicators.ema200)} />
          <Tile label="VWAP" value={fmtPrice(indicators.vwap)} />
          <Tile label="ATR (14)" value={indicators.atr.toFixed(2)} />
          <Tile label="SMA 20" value={fmtPrice(indicators.sma20)} />
        </div>

        {/* Bollinger bands */}
        <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Bollinger Bands</div>
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-rose-500/80">L {fmtPrice(indicators.bollinger.lower)}</span>
            <span className="text-muted-foreground">M {fmtPrice(indicators.bollinger.middle)}</span>
            <span className="text-emerald-500/80">U {fmtPrice(indicators.bollinger.upper)}</span>
          </div>
        </div>

        {/* Support / resistance */}
        {(indicators.support.length > 0 || indicators.resistance.length > 0) && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-500 mb-0.5">Support</div>
              <div className="font-mono tabular-nums text-emerald-500">
                {indicators.support.length ? indicators.support.map((s) => fmtPrice(s)).join(' · ') : '—'}
              </div>
            </div>
            <div className="rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-rose-500 mb-0.5">Resistance</div>
              <div className="font-mono tabular-nums text-rose-500">
                {indicators.resistance.length ? indicators.resistance.map((r) => fmtPrice(r)).join(' · ') : '—'}
              </div>
            </div>
          </div>
        )}

        <Separator />

        {/* Summary score bar */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">Summary Score</span>
            <span className={cn('text-lg font-bold tabular-nums', scoreColor)}>
              {score > 0 ? '+' : ''}
              {score.toFixed(0)}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <SummaryCount label="Buy" count={indicators.summary.buy} className="text-emerald-500" />
            <SummaryCount label="Neutral" count={indicators.summary.neutral} className="text-amber-500" />
            <SummaryCount label="Sell" count={indicators.summary.sell} className="text-rose-500" />
          </div>
          <div className="relative h-2.5 rounded-full bg-gradient-to-r from-rose-500/50 via-amber-500/40 to-emerald-500/50">
            <div
              className="absolute top-1/2 -translate-y-1/2 h-4 w-1 bg-foreground rounded-full shadow-md"
              style={{ left: `calc(${scorePos}% - 2px)` }}
            />
            <div className="absolute top-0 left-1/2 h-full w-px bg-border/60" />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>-100 Bearish</span>
            <span>0</span>
            <span>Bullish +100</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({
  label,
  value,
  valueClassName,
  badgeClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  badgeClassName?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {badgeClassName ? (
        <span className={cn('inline-block mt-0.5 rounded border px-1.5 py-0.5 text-[11px] font-bold', badgeClassName)}>
          {value}
        </span>
      ) : (
        <div className={cn('text-sm font-mono font-semibold tabular-nums mt-0.5', valueClassName)}>{value}</div>
      )}
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SummaryCount({ label, count, className }: { label: string; count: number; className?: string }) {
  return (
    <div className="text-center rounded-md border border-border/40 bg-muted/20 py-1.5">
      <div className={cn('text-base font-bold tabular-nums', className)}>{count}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order book card
// ---------------------------------------------------------------------------

function OrderBookCard({
  data,
  loading,
  error,
}: {
  data?: OrderbookData;
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Order Book</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Order Book</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-40 items-center justify-center text-sm text-rose-500 gap-2">
            <AlertCircle className="h-4 w-4" /> Failed to load order book
          </div>
        </CardContent>
      </Card>
    );
  }

  const bids = data.bids.slice(0, 15);
  const asks = data.asks.slice(0, 15);
  const maxBidQty = Math.max(...bids.map((b) => b[1]), 1);
  const maxAskQty = Math.max(...asks.map((a) => a[1]), 1);
  const imbalancePct = (data.imbalance * 100).toFixed(1);
  const imbalancePos = data.imbalance > 0;
  const imbalanceColor = imbalancePos ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-500 border-rose-500/30 bg-rose-500/10';

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Order Book</span>
          <span className={cn('text-xs font-bold px-2 py-0.5 rounded-md border tabular-nums', imbalanceColor)}>
            {imbalancePos ? '+' : ''}
            {imbalancePct}% Imbalance
          </span>
        </CardTitle>
        <CardDescription className="text-xs">Top 15 levels · live depth</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          {/* Asks (reversed so best ask is at the bottom near spread) */}
          <div>
            <div className="grid grid-cols-2 gap-1 mb-1 text-muted-foreground">
              <span>Price (Ask)</span>
              <span className="text-right">Qty</span>
            </div>
            <div className="space-y-0.5">
              {asks
                .slice()
                .reverse()
                .map((a, i) => (
                  <OBRow key={`a-${i}`} price={a[0]} qty={a[1]} max={maxAskQty} side="ask" />
                ))}
            </div>
          </div>
          {/* Bids */}
          <div>
            <div className="grid grid-cols-2 gap-1 mb-1 text-muted-foreground">
              <span>Price (Bid)</span>
              <span className="text-right">Qty</span>
            </div>
            <div className="space-y-0.5">
              {bids.map((b, i) => (
                <OBRow key={`b-${i}`} price={b[0]} qty={b[1]} max={maxBidQty} side="bid" />
              ))}
            </div>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spread</div>
            <div className="font-mono tabular-nums">{data.spread.toFixed(4)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Bid / Ask Depth</div>
            <div className="font-mono tabular-nums text-[11px]">
              <span className="text-emerald-500">{fmtVol(data.bidDepth)}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-rose-500">{fmtVol(data.askDepth)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OBRow({ price, qty, max, side }: { price: number; qty: number; max: number; side: 'bid' | 'ask' }) {
  const pct = Math.min(100, (qty / max) * 100);
  const isBid = side === 'bid';
  return (
    <div className="relative grid grid-cols-2 gap-1 py-0.5">
      <div
        className={cn('absolute inset-y-0 right-0', isBid ? 'bg-emerald-500/15' : 'bg-rose-500/15')}
        style={{ width: `${pct}%` }}
      />
      <span className={cn('relative font-mono tabular-nums', isBid ? 'text-emerald-500' : 'text-rose-500')}>
        {fmtPrice(price)}
      </span>
      <span className="relative text-right font-mono tabular-nums text-muted-foreground">{qty.toFixed(4)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funding & Open Interest card
// ---------------------------------------------------------------------------

function FundingOICard({ data, price }: { data?: OrderbookData | null; price?: number }) {
  const funding = data?.funding ?? null;
  const oi = data?.openInterest ?? null;

  const rate = funding?.rate;
  const fundingPct = rate != null ? (rate * 100).toFixed(4) : '—';
  const fundingColor = rate != null && rate > 0 ? 'text-rose-500' : rate != null && rate < 0 ? 'text-emerald-500' : 'text-foreground';

  const oiTokens = oi?.openInterest;
  const oiValue = oiTokens != null && price != null ? oiTokens * price : undefined;

  const nextFunding = funding?.nextFunding;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-4 w-4 text-amber-500" /> Funding & Open Interest
        </CardTitle>
        <CardDescription className="text-xs">Binance Futures · derivatives sentiment</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Funding Rate</div>
            <div className={cn('text-xl font-bold font-mono tabular-nums', fundingColor)}>
              {fundingPct}
              <span className="text-sm">%</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'text-[10px]',
              rate != null && rate > 0
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-500'
                : rate != null && rate < 0
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                : ''
            )}
          >
            {rate != null && rate > 0 ? 'Longs → Shorts' : rate != null && rate < 0 ? 'Shorts → Longs' : 'N/A'}
          </Badge>
        </div>

        {nextFunding != null && (
          <div className="text-[11px] text-muted-foreground">
            Next funding: <span className="font-mono">{new Date(nextFunding).toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}</span>
          </div>
        )}

        <Separator />

        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Open Interest</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {oiTokens != null ? oiTokens.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
            </div>
            <div className="text-[10px] text-muted-foreground">tokens</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Notional Value</div>
            <div className="text-sm font-mono tabular-nums">{oiValue != null ? fmtVol(oiValue) : '—'}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Deep analysis card
// ---------------------------------------------------------------------------

interface ScanResult {
  signalId: string;
  consensus: ConsensusResult;
  alerted: boolean;
}

function DeepAnalysisCard({ symbol, tf }: { symbol: string; tf: Interval }) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/crypto/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, interval: tf, sendAlert: false }),
      });
      const j: ApiResult<ScanResult> = await r.json();
      if (!j.success || !j.data) throw new Error(j.error || 'scan failed');
      setResult(j.data);
      if (j.data.alerted) {
        toast.success('Alert sent to Telegram', { description: `${symbol} · ${j.data.consensus.direction.toUpperCase()} · ${j.data.consensus.conviction}/100` });
      } else {
        toast.success('Deep analysis complete', {
          description: `${symbol} · ${j.data.consensus.direction.toUpperCase()} · ${j.data.consensus.conviction}/100 conviction`,
        });
      }
    } catch (e: any) {
      setError(e.message || 'unknown error');
      toast.error('Analysis failed', { description: e.message });
    } finally {
      setLoading(false);
    }
  }

  const direction = result?.consensus.direction;
  const dirCfg = {
    long: { label: 'LONG', className: 'bg-emerald-500 text-white border-emerald-500' },
    short: { label: 'SHORT', className: 'bg-rose-500 text-white border-rose-500' },
    neutral: { label: 'NEUTRAL', className: 'bg-amber-500 text-white border-amber-500' },
  };

  return (
    <Card className="border-emerald-500/20 relative overflow-hidden">
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
      <CardHeader className="pb-2 relative">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-500" /> AI Deep Analysis
        </CardTitle>
        <CardDescription className="text-xs">
          Multi-layer consensus fusion · {tf} timeframe
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 relative">
        {!result && !loading && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Runs technical + order-flow + (optional) LLM reasoning layers, fuses them into a single conviction-scored signal with entry, stop, and target.
            </p>
            <Button
              onClick={run}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-white"
              disabled={loading}
            >
              <Sparkles className="h-4 w-4" /> Run Deep Analysis
            </Button>
            {error && (
              <div className="text-xs text-rose-500 p-2 rounded-md bg-rose-500/10 border border-rose-500/20">{error}</div>
            )}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <div className="text-sm font-medium">Analyzing {symbol}…</div>
            <div className="text-[11px] text-muted-foreground">Fusing technical, order-flow, and LLM layers</div>
          </div>
        )}

        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Direction + conviction */}
            <div className="flex items-center justify-between gap-3">
              <Badge className={cn('text-base px-4 py-1.5 font-bold border', dirCfg[direction!].className)}>
                {dirCfg[direction!].label}
              </Badge>
              <Button variant="outline" size="sm" onClick={run} disabled={loading}>
                <RefreshCw className="h-3 w-3" /> Re-run
              </Button>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Conviction</span>
                <span className="font-mono font-bold tabular-nums">{result.consensus.conviction}/100</span>
              </div>
              <Progress
                value={result.consensus.conviction}
                className="h-2 bg-muted"
              />
            </div>

            {/* Entry / Stop / Target */}
            {(result.consensus.entryPrice != null ||
              result.consensus.stopLoss != null ||
              result.consensus.takeProfit != null) && (
              <div className="grid grid-cols-3 gap-2">
                <PriceBox label="Entry" value={result.consensus.entryPrice} accent="emerald" icon={<Target className="h-3 w-3" />} />
                <PriceBox label="Stop Loss" value={result.consensus.stopLoss} accent="rose" icon={<ShieldAlert className="h-3 w-3" />} />
                <PriceBox label="Take Profit" value={result.consensus.takeProfit} accent="emerald" icon={<TrendingUp className="h-3 w-3" />} />
              </div>
            )}

            {/* Layers */}
            <div className="space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Layers Breakdown ({result.consensus.layers.length})
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {result.consensus.layers.map((l, i) => (
                  <LayerRow key={i} layer={l} />
                ))}
              </div>
            </div>

            {/* Rationale */}
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1">
                <BookOpen className="h-3 w-3" /> Rationale
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap leading-relaxed">
                {result.consensus.rationale}
              </div>
            </div>

            {result.consensus.modelsUsed.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {result.consensus.modelsUsed.map((m, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-mono">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

function PriceBox({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value?: number | null;
  accent: 'emerald' | 'rose' | 'amber';
  icon?: React.ReactNode;
}) {
  const colors = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-500',
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-500',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-500',
  };
  return (
    <div className={cn('rounded-md border px-2.5 py-2', colors[accent])}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-sm font-mono font-bold tabular-nums">{value != null ? fmtPrice(value) : '—'}</div>
    </div>
  );
}

function LayerRow({ layer }: { layer: LayerScore }) {
  const score = layer.score;
  const color = score > 15 ? 'text-emerald-500' : score < -15 ? 'text-rose-500' : 'text-amber-500';
  const dot = score > 15 ? 'bg-emerald-500' : score < -15 ? 'bg-rose-500' : 'bg-amber-500';
  const pos = (score + 100) / 2; // 0..100

  return (
    <div className="rounded-md border border-border/50 bg-muted/20 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium capitalize flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
          {layer.layer}
        </span>
        <span className={cn('font-mono font-bold tabular-nums', color)}>
          {score > 0 ? '+' : ''}
          {score.toFixed(0)}
        </span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted">
        <div className="absolute top-1/2 left-1/2 h-px w-px bg-border" />
        <div
          className={cn('absolute top-1/2 -translate-y-1/2 h-2.5 w-1 rounded-full', dot)}
          style={{ left: `calc(${pos}% - 2px)` }}
        />
      </div>
      <div className="text-[11px] text-muted-foreground leading-relaxed">{layer.detail}</div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>confidence {layer.confidence.toFixed(0)}%</span>
        {layer.model && <span className="font-mono truncate max-w-[60%] text-right">{layer.model}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent signals
// ---------------------------------------------------------------------------

function RecentSignals({ symbol }: { symbol: string }) {
  const sigQ = useQuery({
    queryKey: ['signals-recent', symbol],
    queryFn: () => fetchJson<SignalRow[]>('/api/signals?limit=50'),
    refetchInterval: 60_000,
  });

  const filtered = (sigQ.data ?? []).filter((s) => s.asset?.symbol === symbol).slice(0, 5);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-500" /> Recent Signals
          </span>
          <Link href="/signals" className="text-xs text-emerald-500 hover:underline font-normal">
            View all →
          </Link>
        </CardTitle>
        <CardDescription className="text-xs">Last 5 deep analyses for {symbol}</CardDescription>
      </CardHeader>
      <CardContent>
        {sigQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-sm text-muted-foreground">No signals yet for {symbol}</div>
            <div className="text-xs text-muted-foreground">Run a deep analysis above to generate one</div>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {filtered.map((s) => (
              <SignalRowItem key={s.id} signal={s} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalRowItem({ signal }: { signal: SignalRow }) {
  const cfg = {
    long: { color: 'text-emerald-500', bg: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', label: 'LONG' },
    short: { color: 'text-rose-500', bg: 'bg-rose-500/15 text-rose-500 border-rose-500/30', label: 'SHORT' },
    neutral: { color: 'text-amber-500', bg: 'bg-amber-500/15 text-amber-500 border-amber-500/30', label: 'NEUTRAL' },
  }[signal.direction];

  return (
    <div className="rounded-md border border-border/50 p-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('font-bold', cfg.bg)}>
            {cfg.label}
          </Badge>
          <span className="text-[11px] text-muted-foreground">{signal.timeframe}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={cn('font-bold tabular-nums', cfg.color)}>{signal.conviction}/100</span>
          <span className="text-muted-foreground text-[11px]">{relativeTime(signal.timestamp)}</span>
        </div>
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{signal.rationale}</div>
      {(signal.entryPrice != null || signal.stopLoss != null || signal.takeProfit != null) && (
        <div className="flex gap-3 mt-2 text-[11px] font-mono tabular-nums">
          {signal.entryPrice != null && (
            <span>
              <span className="text-muted-foreground">E </span>
              {fmtPrice(signal.entryPrice)}
            </span>
          )}
          {signal.stopLoss != null && (
            <span>
              <span className="text-muted-foreground">S </span>
              {fmtPrice(signal.stopLoss)}
            </span>
          )}
          {signal.takeProfit != null && (
            <span>
              <span className="text-muted-foreground">T </span>
              {fmtPrice(signal.takeProfit)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
