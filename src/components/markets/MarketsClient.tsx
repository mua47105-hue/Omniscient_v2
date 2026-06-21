'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Globe2,
  ArrowLeftRight,
  Building2,
  BarChart3,
  Boxes,
  LineChart,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  AlertCircle,
  Loader2,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  Radio,
  Coins,
  Fuel,
  Layers,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import type { ApiResult, Kline } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types — mirror what /api/markets/quotes returns
// ---------------------------------------------------------------------------
interface MarketQuote {
  symbol: string;
  name: string;
  assetClass: 'crypto' | 'forex' | 'stock' | 'index' | 'commodity' | string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  yearHigh?: number;
  yearLow?: number;
  volume?: number;
  currency?: string;
  klines?: Kline[];
  source: 'binance' | 'yahoo';
}

type QuotesMap = Record<string, MarketQuote>;
type TabKey = 'all' | 'forex' | 'stock' | 'index' | 'commodity';

const TAB_DEFS: { key: TabKey; label: string; icon: any }[] = [
  { key: 'all', label: 'All', icon: Layers },
  { key: 'forex', label: 'Forex', icon: ArrowLeftRight },
  { key: 'stock', label: 'Stocks', icon: Building2 },
  { key: 'index', label: 'Indices', icon: BarChart3 },
  { key: 'commodity', label: 'Commodities', icon: Boxes },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchQuotes(tab: TabKey): Promise<QuotesMap> {
  const r = await fetch(`/api/markets/quotes?class=${tab}`);
  const j: ApiResult<QuotesMap> = await r.json();
  if (!j.success) throw new Error(j.error || 'Failed to load market quotes');
  return (j.data as QuotesMap) || {};
}

function fmtPrice(p: number, currency = 'USD'): string {
  if (!isFinite(p) || p === 0) return '—';
  const prefix = currency === 'USD' ? '$' : '';
  if (p >= 10000) return prefix + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return prefix + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return prefix + p.toFixed(2);
  if (p >= 0.01) return prefix + p.toFixed(4);
  return prefix + p.toFixed(6);
}

function fmtVol(v?: number): string {
  if (!v || v <= 0) return '—';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function isIndianStock(symbol: string): boolean {
  return /\.NS$|\.BO$/.test(symbol);
}

type Accent = 'emerald' | 'amber' | 'rose' | 'orange' | 'teal';
function accentForQuote(q: MarketQuote): Accent {
  if (q.assetClass === 'forex') return 'emerald';
  if (q.assetClass === 'stock') return 'rose';
  if (q.assetClass === 'index') return 'orange';
  if (q.assetClass === 'commodity') return 'amber';
  return 'emerald';
}

const accentClasses: Record<Accent, { bg: string; text: string; border: string; grad: string; marker: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30', grad: 'from-emerald-500/20 to-transparent', marker: 'bg-emerald-500' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30', grad: 'from-amber-500/20 to-transparent', marker: 'bg-amber-500' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/30', grad: 'from-rose-500/20 to-transparent', marker: 'bg-rose-500' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30', grad: 'from-orange-500/20 to-transparent', marker: 'bg-orange-500' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-500', border: 'border-teal-500/30', grad: 'from-teal-500/20 to-transparent', marker: 'bg-teal-500' },
};

// Renders the right lucide icon for an asset class + symbol without dynamically
// assigning a component to a capitalized variable inside the consumer's render
// (keeps the react-hooks/static-components lint rule happy).
function ClassIcon({ ac, symbol, className }: { ac: string; symbol: string; className?: string }) {
  if (ac === 'forex') return <ArrowLeftRight className={className} />;
  if (ac === 'stock') return <Building2 className={className} />;
  if (ac === 'index') return <BarChart3 className={className} />;
  if (ac === 'commodity') {
    if (/CL=F|BZ=F|NG=F/.test(symbol)) return <Fuel className={className} />;
    if (/GC=F|SI=F|HG=F/.test(symbol)) return <Coins className={className} />;
    return <Boxes className={className} />;
  }
  return <LineChart className={className} />;
}

function cleanSymbol(sym: string): string {
  return sym
    .replace(/=X$/, '')
    .replace(/\.NS$|\.BO$/, '')
    .replace(/-USD$/, '')
    .replace(/=F$/, '');
}

// Forex flag emoji helper — shows base/quote flag pair.
function currencyToFlag(c: string): string {
  switch (c) {
    case 'USD': return '\u{1F1FA}\u{1F1F8}'; // 🇺🇸
    case 'EUR': return '\u{1F1EA}\u{1F1EA}'; // 🇪🇺
    case 'GBP': return '\u{1F1EC}\u{1F1E7}'; // 🇬🇧
    case 'JPY': return '\u{1F1EF}\u{1F1F5}'; // 🇯🇵
    case 'CHF': return '\u{1F1E8}\u{1F1ED}'; // 🇨🇭
    case 'AUD': return '\u{1F1E6}\u{1F1FA}'; // 🇦🇺
    case 'CAD': return '\u{1F1E8}\u{1F1E6}'; // 🇨🇦
    case 'INR': return '\u{1F1EE}\u{1F1F3}'; // 🇮🇳
    case 'CNY': return '\u{1F1E8}\u{1F1F3}'; // 🇨🇳
    case 'SGD': return '\u{1F1F8}\u{1F1EC}'; // 🇸🇬
    case 'HKD': return '\u{1F1ED}\u{1F1F0}'; // 🇭🇰
    default: return '';
  }
}

function ForexFlag({ symbol }: { symbol: string }) {
  const cleaned = symbol.replace(/=X$/, '');
  if (cleaned.length < 6) return null;
  const base = cleaned.slice(0, 3);
  const quote = cleaned.slice(3, 6);
  const f1 = currencyToFlag(base);
  const f2 = currencyToFlag(quote);
  if (!f1 && !f2) return null;
  return (
    <span className="select-none text-[11px] leading-none tracking-tighter" aria-hidden>
      <span className="me-0.5">{f1}</span>
      <span>{f2}</span>
    </span>
  );
}

function exchangeForStock(symbol: string): string | null {
  if (/\.NS$/.test(symbol)) return 'NSE';
  if (/\.BO$/.test(symbol)) return 'BSE';
  if (/\.(L|TO|AX|HK|PA|DE|SW|T)\.?/.test(symbol)) return null; // skip other intl exchanges
  // Major NASDAQ-listed tech names
  const nasdaqTickers = ['AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','META','TSLA','NFLX','AVGO','PEP','COST','INTC','AMD','QCOM','ADBE','PYPL','CSCO','TXN','TMUS'];
  const root = symbol.replace(/=F$|=X$|\.NS$|\.BO$/g, '').replace(/[-.].*$/, '');
  if (nasdaqTickers.some((t) => root === t)) return 'NASDAQ';
  // Default US stocks to NYSE (good enough heuristic for visual badge)
  return root ? 'NYSE' : null;
}

function commodityEmoji(symbol: string): string | null {
  if (/GC=F/.test(symbol)) return '\u{1F947}'; // 🥇
  if (/SI=F/.test(symbol)) return '\u{1F948}'; // 🥈
  if (/HG=F/.test(symbol)) return '\u{1F7E4}'; // 🟤 (copper)
  if (/CL=F|BZ=F/.test(symbol)) return '\u{1F6E2}\u{FE0F}'; // 🛢️
  if (/NG=F/.test(symbol)) return '\u{26A1}'; // ⚡
  if (/ZW=F|KE=F|ZC=F/.test(symbol)) return '\u{1F33E}'; // 🌾 (wheat/corn)
  if (/KC=F/.test(symbol)) return '\u{2615}'; // ☕ (coffee)
  if (/SB=F/.test(symbol)) return '\u{1F36C}'; // 🍬 (sugar)
  return null;
}

// ---------------------------------------------------------------------------
// Sparkline (60px AreaChart, direction-colored)
// ---------------------------------------------------------------------------
function Sparkline({ klines }: { klines?: Kline[] }) {
  const id = useMemo(() => `spark-${Math.random().toString(36).slice(2, 9)}`, []);
  if (!klines || klines.length < 2) {
    return (
      <div className="h-[60px] flex items-center justify-center text-[10px] text-muted-foreground/50 italic">
        no chart data
      </div>
    );
  }
  const data = klines.map((k) => ({ t: k.openTime, v: k.close }));
  const first = data[0].v;
  const last = data[data.length - 1].v;
  const up = last >= first;
  const stroke = up ? '#10b981' : '#f43f5e';
  return (
    <div className="h-[60px] -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 11,
              padding: '4px 8px',
            }}
            labelFormatter={() => ''}
            formatter={(v: number) => [fmtPrice(v), 'Price']}
          />
          <Area
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={1.6}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset Card
// ---------------------------------------------------------------------------
function AssetCard({ q, index }: { q: MarketQuote; index: number }) {
  const accent = accentForQuote(q);
  const a = accentClasses[accent];
  const up = q.changePct >= 0;
  const display = cleanSymbol(q.symbol);
  const hasYearRange = q.yearHigh && q.yearHigh > 0 && q.yearLow !== undefined && q.yearLow > 0;
  const exchange = q.assetClass === 'stock' ? exchangeForStock(q.symbol) : null;
  const commodityEm = q.assetClass === 'commodity' ? commodityEmoji(q.symbol) : null;
  const isForex = q.assetClass === 'forex';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, delay: Math.min(index * 0.025, 0.4), ease: 'easeOut' }}
      className="h-full"
    >
      <Card
        className={cn(
          'group relative h-full overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:border-emerald-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 dark:hover:shadow-black/30 transition-all duration-200 ease-out cursor-pointer',
          a.border
        )}
      >
        {/* Hover left accent */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-12 w-[3px] rounded-r-full bg-gradient-to-b from-emerald-400 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-[0_0_10px_rgba(16,185,129,0.6)]"
        />
        <div className={cn('absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gradient-to-br blur-2xl opacity-70 transition-opacity duration-300 group-hover:opacity-100', a.grad)} />
        <CardHeader className="pb-2 relative">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-border/30 transition-transform duration-200 group-hover:scale-105', a.bg, a.text)}>
                <ClassIcon ac={q.assetClass} symbol={q.symbol} className="h-4 w-4" />
                {commodityEm && (
                  <span className="absolute -bottom-1 -right-1 text-[10px] leading-none select-none" aria-hidden>
                    {commodityEm}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold leading-tight truncate flex items-center gap-1">
                  {isForex && <ForexFlag symbol={q.symbol} />}
                  {display}
                  {exchange && (
                    <span className="select-none inline-flex items-center rounded-sm border border-border/70 bg-muted/60 px-1 py-0 text-[8px] font-bold uppercase tracking-wider text-muted-foreground">
                      {exchange}
                    </span>
                  )}
                </CardTitle>
                <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">{q.name}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold gap-0.5 transition-transform duration-200 group-hover:scale-105',
                  up ? 'text-emerald-500 border-emerald-500/40 bg-emerald-500/5' : 'text-rose-500 border-rose-500/40 bg-rose-500/5'
                )}
              >
                {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(q.changePct).toFixed(2)}%
              </Badge>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                {q.source === 'binance' ? 'Binance' : 'Yahoo'}
              </span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="relative">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums tracking-tight font-mono">
              {fmtPrice(q.price, q.currency)}
            </span>
            <span className={cn('text-[11px] font-medium tabular-nums', up ? 'text-emerald-500' : 'text-rose-500')}>
              {up ? '+' : ''}{q.change.toFixed(q.price >= 100 ? 2 : 4)}
            </span>
          </div>

          <div className="mt-2">
            <Sparkline klines={q.klines} />
          </div>

          <Separator className="my-2.5" />

          <div className="grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex flex-col">
              <span className="text-muted-foreground/70 uppercase tracking-wider">Day Low</span>
              <span className="font-mono tabular-nums text-foreground/90">
                {q.dayLow > 0 ? fmtPrice(q.dayLow, q.currency) : '—'}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-muted-foreground/70 uppercase tracking-wider">Day High</span>
              <span className="font-mono tabular-nums text-foreground/90">
                {q.dayHigh > 0 ? fmtPrice(q.dayHigh, q.currency) : '—'}
              </span>
            </div>
            {q.volume !== undefined && q.volume > 0 ? (
              <div className="flex flex-col col-span-2">
                <span className="text-muted-foreground/70 uppercase tracking-wider">Volume</span>
                <span className="font-mono tabular-nums text-foreground/90">{fmtVol(q.volume)}</span>
              </div>
            ) : hasYearRange ? (
              <>
                <div className="flex flex-col">
                  <span className="text-muted-foreground/70 uppercase tracking-wider">52w Low</span>
                  <span className="font-mono tabular-nums text-foreground/90">{fmtPrice(q.yearLow || 0, q.currency)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-muted-foreground/70 uppercase tracking-wider">52w High</span>
                  <span className="font-mono tabular-nums text-foreground/90">{fmtPrice(q.yearHigh || 0, q.currency)}</span>
                </div>
              </>
            ) : null}
          </div>

          {hasYearRange && q.price > 0 && (
            <div className="mt-2.5">
              <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('absolute top-0 h-full w-2 rounded-full transition-all duration-200', a.marker)}
                  style={{
                    left: `${Math.max(0, Math.min(96, ((q.price - (q.yearLow || 0)) / ((q.yearHigh || 1) - (q.yearLow || 0))) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Card Skeleton
// ---------------------------------------------------------------------------
function CardSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-2 w-24" />
            </div>
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-28 mb-2" />
        <Skeleton className="h-[60px] w-full" />
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stats Strip
// ---------------------------------------------------------------------------
function StatsTile({
  label,
  value,
  sub,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent: Accent;
  loading: boolean;
}) {
  const a = accentClasses[accent];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card
        className={cn(
          'group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:border-border hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 ease-out',
          a.border,
        )}
      >
        <div className={cn('absolute -right-5 -top-5 h-20 w-20 rounded-full bg-gradient-to-br blur-2xl opacity-60 transition-opacity duration-300 group-hover:opacity-100', a.grad)} />
        <CardContent className="p-4 relative">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-md ring-1 ring-inset ring-border/30 transition-transform duration-200 group-hover:scale-110', a.bg, a.text)}>{icon}</div>
          </div>
          {loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <div className="text-xl font-bold tabular-nums tracking-tight truncate font-mono">{value}</div>
          )}
          {sub && !loading && <div className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</div>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function StatsStrip({
  total,
  showing,
  avgChange,
  topGainer,
  topLoser,
  loading,
}: {
  total: number;
  showing: number;
  avgChange: number;
  topGainer?: MarketQuote;
  topLoser?: MarketQuote;
  loading: boolean;
}) {
  const avgUp = avgChange >= 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatsTile
        label="Assets tracked"
        value={String(total)}
        sub={`${showing} with live data`}
        icon={<Layers className="h-4 w-4" />}
        accent="emerald"
        loading={loading}
      />
      <StatsTile
        label="Avg change"
        value={`${avgUp ? '+' : ''}${avgChange.toFixed(2)}%`}
        sub="across visible assets"
        icon={avgUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        accent={avgUp ? 'emerald' : 'orange'}
        loading={loading}
      />
      <StatsTile
        label="Top gainer"
        value={topGainer ? cleanSymbol(topGainer.symbol) : '—'}
        sub={topGainer ? `+${topGainer.changePct.toFixed(2)}% · ${fmtPrice(topGainer.price, topGainer.currency)}` : 'no data'}
        icon={<ArrowUpRight className="h-4 w-4" />}
        accent="emerald"
        loading={loading}
      />
      <StatsTile
        label="Top loser"
        value={topLoser ? cleanSymbol(topLoser.symbol) : '—'}
        sub={topLoser ? `${topLoser.changePct.toFixed(2)}% · ${fmtPrice(topLoser.price, topLoser.currency)}` : 'no data'}
        icon={<ArrowDownRight className="h-4 w-4" />}
        accent="orange"
        loading={loading}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rate-limit banner
// ---------------------------------------------------------------------------
function RateLimitBanner({ onRetry, refreshing }: { onRetry: () => void; refreshing: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          Yahoo Finance is rate-limiting requests right now.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Data will appear automatically when the rate limit clears (usually within a few minutes). Cached data may still be available.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={refreshing}
        className="border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 shrink-0"
      >
        {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Retry now
      </Button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-500/40 bg-rose-500/5">
      <CardContent className="p-6 flex flex-col items-center text-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/15 text-rose-500">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">Failed to load market data</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry} className="border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
function EmptyState({ kind, tabLabel }: { kind: 'no-data' | 'no-search'; tabLabel: string }) {
  if (kind === 'no-search') {
    return (
      <Card className="border-dashed border-border/60">
        <CardContent className="p-8 flex flex-col items-center text-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Search className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium">No assets match your search</p>
          <p className="text-xs text-muted-foreground">Try a different symbol or name.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="border-dashed border-border/60">
      <CardContent className="p-8 flex flex-col items-center text-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">No data currently available for {tabLabel}</p>
        <p className="text-xs text-muted-foreground max-w-md">
          Yahoo Finance may be rate-limiting — try again in a moment. The page will auto-refresh every 5 minutes.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton grid (loading state)
// ---------------------------------------------------------------------------
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main client — owns the query + stats + search + tabs
// ---------------------------------------------------------------------------
export function MarketsClient() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<QuotesMap, Error>({
    queryKey: ['markets-quotes', tab],
    queryFn: () => fetchQuotes(tab),
    refetchInterval: 5 * 60 * 1000, // 5 min
    staleTime: 60 * 1000,
  });

  // Build the display list (filter crypto out of "all" since crypto has its own page)
  const allQuotes = useMemo<MarketQuote[]>(() => {
    if (!data) return [];
    return Object.values(data).filter((q) => {
      if (tab === 'all' && q.assetClass === 'crypto') return false;
      return true;
    });
  }, [data, tab]);

  const filtered = useMemo<MarketQuote[]>(() => {
    if (!search.trim()) return allQuotes;
    const q = search.trim().toLowerCase();
    return allQuotes.filter(
      (item) =>
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        cleanSymbol(item.symbol).toLowerCase().includes(q)
    );
  }, [allQuotes, search]);

  // Sort: gainers first, losers last
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => b.changePct - a.changePct);
  }, [filtered]);

  // Stats from the active tab's data
  const stats = useMemo(() => {
    if (allQuotes.length === 0) {
      return { total: 0, showing: 0, avgChange: 0 };
    }
    const showing = allQuotes.filter((q) => q.price > 0).length;
    const avg = showing > 0 ? allQuotes.reduce((s, q) => s + (q.changePct || 0), 0) / showing : 0;
    const sortedByChange = [...allQuotes].sort((a, b) => b.changePct - a.changePct);
    return {
      total: allQuotes.length,
      showing,
      avgChange: avg,
      topGainer: sortedByChange[0],
      topLoser: sortedByChange[sortedByChange.length - 1],
    };
  }, [allQuotes]);

  const isRateLimited = !isLoading && !isError && allQuotes.length === 0;
  const hasSearchNoMatch = !isLoading && !isError && allQuotes.length > 0 && sorted.length === 0;

  const handleManualRefresh = async () => {
    setRefreshing(true);
    toast.info('Refreshing market data…', {
      description: 'Pulling fresh quotes from Yahoo Finance + Binance.',
    });
    try {
      await queryClient.invalidateQueries({ queryKey: ['markets-quotes'] });
      await queryClient.refetchQueries({ queryKey: ['markets-quotes'] });
      toast.success('Markets refreshed', { description: 'Latest quotes loaded.' });
    } catch (e: any) {
      toast.error('Refresh failed', { description: e?.message });
    } finally {
      setRefreshing(false);
    }
  };

  const tabLabel = TAB_DEFS.find((t) => t.key === tab)?.label || tab;

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500 border border-emerald-500/20">
              <span aria-hidden className="absolute inset-0 rounded-xl bg-emerald-400/30 blur-md opacity-50 group-hover:opacity-90 transition-opacity duration-300" />
              <Globe2 className="relative h-5 w-5 transition-transform duration-300 group-hover:rotate-12" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5 text-balance">
                Global Markets
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                  </span>
                  Live
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground text-pretty">
                Forex · Stocks · Indices · Commodities — live across NSE, BSE, NASDAQ, NYSE
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search symbol or name…"
              className="pl-8 w-full sm:w-64 h-9 transition-colors duration-200 focus-visible:border-emerald-500/40"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="h-9 shrink-0 transition-all duration-200 hover:border-emerald-500/40 hover:text-emerald-500 hover:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', (refreshing || isFetching) && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Stats strip */}
      <StatsStrip
        total={stats.total}
        showing={stats.showing}
        avgChange={stats.avgChange}
        topGainer={stats.topGainer}
        topLoser={stats.topLoser}
        loading={isLoading}
      />

      {/* Tabs + content */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList className="h-9 p-1 gap-0.5 bg-muted/60 backdrop-blur-sm">
            {TAB_DEFS.map((t) => {
              const Icon = t.icon;
              const count =
                t.key === 'all'
                  ? allQuotes.length
                  : allQuotes.filter((q) => q.assetClass === t.key).length;
              return (
                <TabsTrigger
                  key={t.key}
                  value={t.key}
                  className="gap-1.5 transition-all duration-200 ease-out data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm hover:bg-muted"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <span
                    className={cn(
                      'ml-1 inline-flex items-center justify-center rounded-full px-1.5 py-0 text-[9px] font-bold tabular-nums leading-tight min-w-[16px] transition-colors duration-200',
                      tab === t.key
                        ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-muted-foreground/15 text-muted-foreground',
                    )}
                  >
                    {count}
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Radio className="h-3 w-3 text-emerald-500 animate-pulse" />
            <span>Auto-refresh every 5 min</span>
            {isFetching && !isLoading && (
              <span className="flex items-center gap-1 ml-2 text-emerald-500">
                <Loader2 className="h-3 w-3 animate-spin" />
                fetching
              </span>
            )}
          </div>
        </div>

        {/* Single content panel — the active tab's data drives everything.
            Using one TabsContent keeps focus management simple and avoids
            mounting multiple TabPanels. */}
        <TabsContent value={tab} className="mt-4 space-y-4">
          {isLoading ? (
            <SkeletonGrid />
          ) : isError ? (
            <ErrorCard message={error?.message || 'Unknown error'} onRetry={() => refetch()} />
          ) : hasSearchNoMatch ? (
            <EmptyState kind="no-search" tabLabel={tabLabel} />
          ) : isRateLimited ? (
            <RateLimitBanner onRetry={() => refetch()} refreshing={isFetching} />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing <span className="text-foreground font-medium">{sorted.length}</span> assets
                </span>
                {isFetching && (
                  <span className="flex items-center gap-1.5 text-emerald-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    refreshing…
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {sorted.map((q, i) => (
                  <AssetCard key={q.symbol} q={q} index={i} />
                ))}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Footer note */}
      <Card className="border-border/40 bg-card/30">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium text-foreground/80">Data sources</span>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-4" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Forex / Stocks / Indices / Commodities → <span className="text-foreground/70">Yahoo Finance</span></span>
            <span>Crypto → <span className="text-foreground/70">Binance</span></span>
          </div>
          <Separator orientation="vertical" className="hidden sm:block h-4" />
          <span className="text-muted-foreground/70">
            <Sparkles className="inline h-3 w-3 mr-1" />
            Quotes cached 5 min server-side to survive rate limits.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
