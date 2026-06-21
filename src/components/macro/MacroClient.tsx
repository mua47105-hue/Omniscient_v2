'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import {
  Globe, DollarSign, TrendingUp, TrendingDown, Activity, Zap, Flame,
  Gauge, BarChart3, Bitcoin, Coins, Fuel, Percent, AlertTriangle,
  ArrowUpRight, ArrowDownRight, Minus, RefreshCw, ExternalLink,
} from 'lucide-react';
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, ReferenceLine,
} from 'recharts';
import type { ApiResult } from '@/lib/types';

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j: ApiResult<T> = await r.json();
  if (!j.success) throw new Error(j.error);
  return j.data as T;
}

interface MacroQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  yearHigh: number;
  yearLow: number;
  currency: string;
  klines: { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }[];
}

interface FearGreed {
  value: number;
  classification: string;
  timestamp: number;
  history: { value: number; classification: string; timestamp: number }[];
}

interface GlobalStats {
  totalMarketCap: number;
  totalVolume: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChangePct24h: number;
  activeCryptos: number;
}

function fmtPrice(p: number, sym?: string): string {
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function fmtBig(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

const macroConfig: { key: string; label: string; icon: any; accent: string; hint: string }[] = [
  { key: 'dxy', label: 'DXY', icon: DollarSign, accent: 'emerald', hint: 'US Dollar Index' },
  { key: 'vix', label: 'VIX', icon: Flame, accent: 'rose', hint: 'Volatility Index' },
  { key: 'gold', label: 'Gold', icon: Coins, accent: 'amber', hint: 'Spot gold / oz' },
  { key: 'oil', label: 'Oil (WTI)', icon: Fuel, accent: 'orange', hint: 'Crude futures' },
  { key: 'sp500', label: 'S&P 500', icon: BarChart3, accent: 'teal', hint: 'US equities' },
  { key: 'nasdaq', label: 'Nasdaq', icon: TrendingUp, accent: 'teal', hint: 'Tech index' },
  { key: 'us10y', label: 'US 10Y', icon: Percent, accent: 'orange', hint: 'Treasury yield %' },
  { key: 'btc', label: 'BTC', icon: Bitcoin, accent: 'amber', hint: 'Bitcoin' },
];

const accentClasses: Record<string, { bg: string; text: string; border: string; grad: string }> = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/30', grad: 'from-emerald-500/20 to-transparent' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/30', grad: 'from-rose-500/20 to-transparent' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/30', grad: 'from-amber-500/20 to-transparent' },
  teal: { bg: 'bg-teal-500/10', text: 'text-teal-500', border: 'border-teal-500/30', grad: 'from-teal-500/20 to-transparent' },
  orange: { bg: 'bg-orange-500/10', text: 'text-orange-500', border: 'border-orange-500/30', grad: 'from-orange-500/20 to-transparent' },
};

function fearGreedColor(v: number): { text: string; bg: string; label: string } {
  if (v < 25) return { text: 'text-rose-500', bg: 'from-rose-500 to-red-600', label: 'Extreme Fear' };
  if (v < 45) return { text: 'text-orange-500', bg: 'from-orange-500 to-amber-500', label: 'Fear' };
  if (v < 55) return { text: 'text-amber-500', bg: 'from-amber-400 to-yellow-400', label: 'Neutral' };
  if (v < 75) return { text: 'text-lime-500', bg: 'from-lime-500 to-emerald-500', label: 'Greed' };
  return { text: 'text-emerald-500', bg: 'from-emerald-500 to-teal-500', label: 'Extreme Greed' };
}

function MacroQuoteCard({ cfg, quote, loading }: { cfg: any; quote?: MacroQuote; loading: boolean }) {
  const Icon = cfg.icon;
  const a = accentClasses[cfg.accent] || accentClasses.emerald;
  const up = (quote?.changePct ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={`relative overflow-hidden border-border/60 hover:border-border transition-all ${quote ? a.border : ''}`}>
        <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${a.grad} blur-2xl`} />
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.bg} ${a.text}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold">{cfg.label}</CardTitle>
                <p className="text-[10px] text-muted-foreground">{cfg.hint}</p>
              </div>
            </div>
            {quote && (
              <Badge variant="outline" className={`text-[10px] ${up ? 'text-emerald-500 border-emerald-500/30' : 'text-rose-500 border-rose-500/30'}`}>
                {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(quote.changePct).toFixed(2)}%
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : quote ? (
            <>
              <div className="text-2xl font-bold tabular-nums tracking-tight">
                {cfg.key === 'us10y' ? quote.price.toFixed(2) + '%' : `${quote.currency === 'USD' ? '$' : ''}${fmtPrice(quote.price)}`}
              </div>
              {quote.klines && quote.klines.length > 5 && (
                <div className="h-10 mt-2 -mx-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={quote.klines.map((k) => ({ t: k.openTime, v: k.close }))}>
                      <defs>
                        <linearGradient id={`grad-${cfg.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={up ? '#10b981' : '#f43f5e'} stopOpacity={0.4} />
                          <stop offset="100%" stopColor={up ? '#10b981' : '#f43f5e'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="v" stroke={up ? '#10b981' : '#f43f5e'} strokeWidth={1.5} fill={`url(#grad-${cfg.key})`} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {quote.yearHigh > 0 && (
                <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
                  <span>L: ${fmtPrice(quote.dayLow || quote.yearLow)}</span>
                  <span>H: ${fmtPrice(quote.dayHigh || quote.yearHigh)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span>Rate-limited — retry shortly</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FearGreedGauge({ fg }: { fg?: FearGreed; loading: boolean }) {
  const v = fg?.value ?? 50;
  const colors = fearGreedColor(v);
  const angle = (v / 100) * 180 - 90;

  return (
    <Card className="relative overflow-hidden border-border/60">
      <div className={`absolute inset-0 bg-gradient-to-br ${colors.bg} opacity-[0.04]`} />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="h-4 w-4 text-amber-500" />
          Crypto Fear & Greed
        </CardTitle>
      </CardHeader>
      <CardContent>
        {fg ? (
          <div className="flex flex-col items-center">
            <div className="relative h-32 w-48">
              <svg viewBox="0 0 200 100" className="w-full h-full">
                <defs>
                  <linearGradient id="fg-grad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#f43f5e" />
                    <stop offset="25%" stopColor="#f97316" />
                    <stop offset="50%" stopColor="#facc15" />
                    <stop offset="75%" stopColor="#84cc16" />
                    <stop offset="100%" stopColor="#10b981" />
                  </linearGradient>
                </defs>
                <path d="M 10 90 A 90 90 0 0 1 190 90" fill="none" stroke="url(#fg-grad)" strokeWidth="14" strokeLinecap="round" />
                <g transform={`rotate(${angle} 100 90)`}>
                  <line x1="100" y1="90" x2="100" y2="28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={colors.text} />
                  <circle cx="100" cy="90" r="6" className={`fill-current ${colors.text}`} />
                </g>
              </svg>
            </div>
            <div className={`text-4xl font-bold tabular-nums ${colors.text}`}>{v}</div>
            <Badge variant="outline" className={`mt-1 ${colors.text} border-current`}>
              {fg.classification}
            </Badge>
            {fg.history && fg.history.length > 1 && (
              <div className="h-12 w-full mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...fg.history].reverse().map((h) => ({ t: h.timestamp, v: h.value }))}>
                    <defs>
                      <linearGradient id="fg-hist" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <YAxis domain={[0, 100]} hide />
                    <Area type="monotone" dataKey="v" stroke="#f59e0b" strokeWidth={1.5} fill="url(#fg-hist)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </CardContent>
    </Card>
  );
}

function GlobalCryptoCard({ stats }: { stats?: GlobalStats }) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Globe className="h-4 w-4 text-emerald-500" />
          Global Crypto Market
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stats ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Total Market Cap</span>
              <span className="text-lg font-bold tabular-nums">{fmtBig(stats.totalMarketCap)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">24h Volume</span>
              <span className="text-sm font-semibold tabular-nums">{fmtBig(stats.totalVolume)}</span>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">BTC Dominance</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-base font-bold tabular-nums text-amber-500">{stats.btcDominance.toFixed(1)}%</span>
                </div>
                <Progress value={stats.btcDominance} className="h-1.5 mt-1" />
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">ETH Dominance</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-base font-bold tabular-nums text-teal-500">{stats.ethDominance.toFixed(1)}%</span>
                </div>
                <Progress value={stats.ethDominance} className="h-1.5 mt-1" />
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">24h Change</span>
              <Badge variant="outline" className={stats.marketCapChangePct24h >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                {stats.marketCapChangePct24h >= 0 ? '+' : ''}{stats.marketCapChangePct24h.toFixed(2)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Active Cryptos</span>
              <span className="text-xs tabular-nums">{stats.activeCryptos.toLocaleString()}</span>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MacroClient() {
  const quotesQ = useQuery({
    queryKey: ['macro-quotes'],
    queryFn: () => fetchJson<Record<string, MacroQuote>>('/api/macro/quotes?keys=dxy,vix,gold,oil,sp500,nasdaq,us10y,btc,eth'),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });
  const fgQ = useQuery({
    queryKey: ['fear-greed'],
    queryFn: () => fetchJson<FearGreed>('/api/macro/fear-greed'),
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });
  const globalQ = useQuery({
    queryKey: ['global-crypto'],
    queryFn: () => fetchJson<GlobalStats>('/api/macro/global'),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const quotes = quotesQ.data ?? {};
  const refetching = quotesQ.isFetching || fgQ.isFetching || globalQ.isFetching;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Global Macro Monitor</h1>
            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10">
              <span className="relative flex h-1.5 w-1.5 mr-1">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              LIVE
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            DXY · VIX · Gold · Oil · Indices · Yields · BTC — fused into one macro overlay
          </p>
        </div>
        <button
          onClick={() => { quotesQ.refetch(); fgQ.refetch(); globalQ.refetch(); }}
          className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Top row: Fear & Greed + Global Crypto + Market Regime */}
      <div className="grid gap-4 lg:grid-cols-3">
        <FearGreedGauge fg={fgQ.data} />
        <GlobalCryptoCard stats={globalQ.data} />
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              Market Regime
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const fg = fgQ.data?.value ?? 50;
              const vix = quotes.vix?.price ?? 0;
              const dxy = quotes.dxy?.price ?? 0;
              let regime = 'Risk-On';
              let color = 'text-emerald-500';
              let bg = 'bg-emerald-500/10';
              let icon = TrendingUp;
              if (vix > 25 || fg < 30) { regime = 'Risk-Off'; color = 'text-rose-500'; bg = 'bg-rose-500/10'; icon = TrendingDown; }
              else if (vix > 20 || fg < 45) { regime = 'Cautious'; color = 'text-amber-500'; bg = 'bg-amber-500/10'; icon = AlertTriangle; }
              const Icon = icon;
              return (
                <div className="flex flex-col items-center justify-center py-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-full ${bg} ${color} mb-2`}>
                    <Icon className="h-7 w-7" />
                  </div>
                  <div className={`text-xl font-bold ${color}`}>{regime}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 text-center">
                    VIX {vix > 0 ? vix.toFixed(1) : '—'} · F&G {fg} · DXY {dxy > 0 ? dxy.toFixed(1) : '—'}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Macro quotes grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Key Markets</h2>
          {quotesQ.error && (
            <span className="text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Some sources rate-limited — partial data shown
            </span>
          )}
        </div>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {macroConfig.map((cfg) => (
            <MacroQuoteCard
              key={cfg.key}
              cfg={cfg}
              quote={quotes[cfg.key]}
              loading={quotesQ.isLoading}
            />
          ))}
        </div>
      </div>

      {/* Inter-market correlation insight */}
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-emerald-500" />
            Inter-Market Read
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(() => {
            const dxy = quotes.dxy;
            const gold = quotes.gold;
            const vix = quotes.vix;
            const btc = quotes.btc;
            const insights: { label: string; value: string; tone: 'bullish' | 'bearish' | 'neutral' }[] = [];
            if (dxy && gold) {
              const tone = dxy.changePct > 0 && gold.changePct < 0 ? 'bearish' : dxy.changePct < 0 && gold.changePct > 0 ? 'bullish' : 'neutral';
              insights.push({ label: 'DXY ↔ Gold', value: `DXY ${dxy.changePct > 0 ? '↑' : '↓'} ${Math.abs(dxy.changePct).toFixed(2)}% · Gold ${gold.changePct > 0 ? '↑' : '↓'} ${Math.abs(gold.changePct).toFixed(2)}%`, tone });
            }
            if (vix) {
              const tone = vix.price > 25 ? 'bearish' : vix.price < 15 ? 'bullish' : 'neutral';
              insights.push({ label: 'Volatility', value: `VIX ${vix.price.toFixed(1)} — ${vix.price > 25 ? 'elevated fear' : vix.price < 15 ? 'complacency' : 'normal range'}`, tone });
            }
            if (btc) {
              const tone = btc.changePct > 2 ? 'bullish' : btc.changePct < -2 ? 'bearish' : 'neutral';
              insights.push({ label: 'BTC Trend', value: `BTC ${btc.changePct > 0 ? '+' : ''}${btc.changePct.toFixed(2)}% — ${tone === 'bullish' ? 'risk appetite' : tone === 'bearish' ? 'risk aversion' : 'consolidating'}`, tone });
            }
            if (insights.length === 0) {
              return <p className="text-sm text-muted-foreground">Loading inter-market correlations…</p>;
            }
            return (
              <div className="grid gap-3 sm:grid-cols-3">
                {insights.map((i) => (
                  <div key={i.label} className="rounded-lg border border-border/60 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{i.label}</div>
                    <div className={`text-xs font-medium ${i.tone === 'bullish' ? 'text-emerald-500' : i.tone === 'bearish' ? 'text-rose-500' : 'text-amber-500'}`}>
                      {i.value}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Data sources footer */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> Yahoo Finance</span>
        <span className="flex items-center gap-1"><Coins className="h-3 w-3" /> Binance PAXG</span>
        <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> alternative.me</span>
        <span className="flex items-center gap-1"><Globe className="h-3 w-3" /> CoinGecko</span>
        <a href="https://finance.yahoo.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground transition-colors">
          <ExternalLink className="h-3 w-3" /> Yahoo
        </a>
      </div>
    </div>
  );
}
