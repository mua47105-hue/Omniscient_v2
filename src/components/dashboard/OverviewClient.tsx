'use client';

import { useQuery } from '@tanstack/react-query';
import { StatCard } from '@/components/dashboard/StatCard';
import { AssetTable } from '@/components/dashboard/AssetTable';
import { LiveTickerBar } from '@/components/dashboard/LiveTickerBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bitcoin, TrendingUp, Activity, Zap, AlertCircle, ArrowUpRight, ArrowDownRight, Gauge, Globe, Flame, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { Ticker, ApiResult } from '@/lib/types';
import { useLiveTicker } from '@/hooks/useLiveTicker';
import { BrainStatusCard } from '@/components/brain/BrainStatusCard';

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const text = await r.text();
  try {
    const j = JSON.parse(text);
    if (!j.success) throw new Error(j.error || 'Request failed');
    return j.data as T;
  } catch (e) {
    // If JSON parse fails (HTML error page from Vercel), return empty data
    if (e instanceof SyntaxError) throw new Error('API unavailable');
    throw e;
  }
}

interface FearGreed { value: number; classification: string; timestamp: number; history: { value: number; timestamp: number }[] }
interface GlobalStats { totalMarketCap: number; totalVolume: number; btcDominance: number; ethDominance: number; marketCapChangePct24h: number; activeCryptos: number }
function fmtBig(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}
function fgColor(v: number): string {
  if (v < 25) return 'text-rose-500';
  if (v < 45) return 'text-orange-500';
  if (v < 55) return 'text-amber-500';
  if (v < 75) return 'text-lime-500';
  return 'text-emerald-500';
}
function fgBg(v: number): string {
  if (v < 25) return 'from-rose-500/20 to-rose-500/5';
  if (v < 45) return 'from-orange-500/20 to-orange-500/5';
  if (v < 55) return 'from-amber-500/20 to-amber-500/5';
  if (v < 75) return 'from-lime-500/20 to-lime-500/5';
  return 'from-emerald-500/20 to-emerald-500/5';
}

export function OverviewClient() {
  const pricesQ = useQuery({
    queryKey: ['crypto-prices'],
    queryFn: () => fetchJson<Ticker[]>('/api/crypto/prices'),
    refetchInterval: 30000,
  });
  const moversQ = useQuery({
    queryKey: ['crypto-movers'],
    queryFn: () => fetchJson<{ gainers: Ticker[]; losers: Ticker[] }>('/api/crypto/movers'),
    refetchInterval: 60000,
  });
  const fgQ = useQuery({
    queryKey: ['fear-greed-home'],
    queryFn: () => fetchJson<FearGreed>('/api/macro/fear-greed'),
    refetchInterval: 30 * 60 * 1000,
    retry: 1,
  });
  const globalQ = useQuery({
    queryKey: ['global-crypto-home'],
    queryFn: () => fetchJson<GlobalStats>('/api/macro/global'),
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  // Live WebSocket ticker feed — used to upgrade BTC/ETH stat cards from
  // 30s-polled to real-time when the WS is connected. Falls back to polled
  // values gracefully if the socket hasn't connected yet.
  const liveTickers = useLiveTicker(['BTCUSDT', 'ETHUSDT']);

  const tickers = pricesQ.data ?? [];
  const gainers = moversQ.data?.gainers ?? [];
  const losers = moversQ.data?.losers ?? [];
  const fg = fgQ.data;
  const global = globalQ.data;

  const polledBtc = tickers.find((t) => t.symbol === 'BTCUSDT');
  const polledEth = tickers.find((t) => t.symbol === 'ETHUSDT');
  // Prefer live WS data; fall back to the polled snapshot.
  const btc = liveTickers.tickers['BTCUSDT'] ?? polledBtc;
  const eth = liveTickers.tickers['ETHUSDT'] ?? polledEth;
  const totalVol = tickers.reduce((s, t) => s + t.quoteVolume, 0);
  const avgChange = tickers.length ? tickers.reduce((s, t) => s + t.changePct, 0) / tickers.length : 0;
  const upCount = tickers.filter((t) => t.changePct > 0).length;
  const breadth = tickers.length ? Math.round((upCount / tickers.length) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Live ticker bar — sits at the very top, above the hero */}
      <LiveTickerBar />

      {/* Hero */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl text-balance bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
          Market Overview
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          Real-time global market intelligence · Deep multi-layer analysis · 24/7 monitoring
        </p>
      </div>

      {/* Brain status banner — surfaces the autonomous system's vital signs
          on the landing page so casual viewers see it's running. Links to /brain. */}
      <BrainStatusCard />

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="BTC / USD"
          value={btc ? `$${btc.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
          change={btc?.changePct}
          icon={<Bitcoin className="h-4 w-4" />}
          accent="amber"
        />
        <StatCard
          title="ETH / USD"
          value={eth ? `$${eth.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
          change={eth?.changePct}
          icon={<Zap className="h-4 w-4" />}
          accent="teal"
        />
        <StatCard
          title="Market Breadth"
          value={`${breadth}%`}
          subtitle={`${upCount}/${tickers.length} up`}
          change={avgChange}
          icon={<Activity className="h-4 w-4" />}
          accent={breadth >= 50 ? 'emerald' : 'rose'}
        />
        <StatCard
          title="24h Volume"
          value={totalVol >= 1e9 ? `$${(totalVol / 1e9).toFixed(2)}B` : `$${(totalVol / 1e6).toFixed(0)}M`}
          subtitle="tracked assets"
          icon={<TrendingUp className="h-4 w-4" />}
          accent="orange"
        />
      </div>

      {/* Market Sentiment Banner — Fear & Greed + Global Crypto */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}>
          <Link href="/macro" aria-label="View Fear & Greed index">
            <Card className={`group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200 ease-out cursor-pointer h-full`}>
              <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${fg ? fgBg(fg.value) : 'from-amber-500/20 to-amber-500/5'} blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-80`} />
              <CardContent className="relative p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Gauge className="h-3 w-3" /> Fear & Greed
                  </span>
                  {fg && <Badge variant="outline" className={`text-[9px] ${fgColor(fg.value)} border-current`}>{fg.classification}</Badge>}
                </div>
                {fg ? (
                  <div className="flex items-end gap-2">
                    <span className={`text-3xl font-bold tabular-nums ${fgColor(fg.value)}`}>{fg.value}</span>
                    <span className="text-[10px] text-muted-foreground mb-1">/ 100</span>
                  </div>
                ) : (
                  <div className="h-9 w-16 bg-muted/40 rounded animate-pulse" />
                )}
                <div className="mt-2 h-1.5 w-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500 relative overflow-hidden">
                  {fg && (
                    <div className="absolute top-1/2 -translate-y-1/2 h-3 w-1 rounded-full bg-white shadow-lg transition-all" style={{ left: `${fg.value}%` }} />
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, delay: 0.05 }}>
          <Link href="/macro" aria-label="View global market cap">
            <Card className="group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-200 ease-out cursor-pointer h-full">
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-emerald-500/20 to-emerald-500/5 blur-2xl opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="relative p-4">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
                  <Globe className="h-3 w-3 transition-transform duration-200 group-hover:rotate-12" /> Total Mkt Cap
                </span>
                {global ? (
                  <>
                    <div className="text-2xl font-bold tabular-nums">{fmtBig(global.totalMarketCap)}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <Badge variant="outline" className={`text-[10px] ${global.marketCapChangePct24h >= 0 ? 'text-emerald-500' : 'text-rose-500'} border-current`}>
                        {global.marketCapChangePct24h >= 0 ? '+' : ''}{global.marketCapChangePct24h.toFixed(2)}%
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">24h</span>
                    </div>
                  </>
                ) : (
                  <div className="h-9 w-24 bg-muted/40 rounded animate-pulse" />
                )}
              </CardContent>
            </Card>
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, delay: 0.1 }}>
          <Link href="/macro" aria-label="View BTC dominance">
            <Card className="group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-200 ease-out cursor-pointer h-full">
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-amber-500/20 to-amber-500/5 blur-2xl opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="relative p-4">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
                  <Bitcoin className="h-3 w-3 transition-transform duration-200 group-hover:scale-110" /> BTC Dominance
                </span>
                {global ? (
                  <>
                    <div className="text-2xl font-bold tabular-nums text-amber-500">{global.btcDominance.toFixed(1)}%</div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-amber-500 to-amber-400" style={{ width: `${global.btcDominance}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="h-9 w-20 bg-muted/40 rounded animate-pulse" />
                )}
              </CardContent>
            </Card>
          </Link>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, delay: 0.15 }}>
          <Link href="/analytics" aria-label="View volatility analytics">
            <Card className="group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:-translate-y-0.5 hover:border-rose-500/40 hover:shadow-lg hover:shadow-rose-500/5 transition-all duration-200 ease-out cursor-pointer h-full">
              <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-rose-500/20 to-rose-500/5 blur-2xl opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
              <CardContent className="relative p-4">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-2">
                  <Flame className="h-3 w-3 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6" /> Volatility
                </span>
                <div className="text-2xl font-bold tabular-nums text-rose-500">
                  {fg ? (fg.value < 30 ? 'High' : fg.value < 50 ? 'Elevated' : 'Normal') : '—'}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {fg && fg.value < 30 ? 'Capitulation zone' : fg && fg.value < 50 ? 'Fear detected' : 'Stable regime'}
                </div>
              </CardContent>
            </Card>
          </Link>
        </motion.div>
      </div>

      {/* Movers + Watchlist */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-border/60 ring-1 ring-inset ring-border/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Watchlist
            </CardTitle>
            <Link href="/crypto" className="group text-xs text-emerald-500 hover:underline flex items-center gap-0.5">
              View all
              <ChevronRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </CardHeader>
          <CardContent>
            {pricesQ.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-md bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : pricesQ.error ? (
              <div className="flex items-center gap-2 text-sm text-rose-500 py-8 justify-center">
                <AlertCircle className="h-4 w-4" /> Failed to load market data
              </div>
            ) : (
              <AssetTable
                rows={tickers.map((t) => ({
                  symbol: t.symbol,
                  price: t.price,
                  changePct: t.changePct,
                  quoteVolume: t.quoteVolume,
                }))}
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60 ring-1 ring-inset ring-border/30 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-emerald-500" /> Top Gainers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {moversQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted/40 animate-pulse" />)
              ) : (
                gainers.slice(0, 5).map((t, idx) => (
                  <Link
                    key={t.symbol}
                    href={`/crypto/${encodeURIComponent(t.symbol)}`}
                    className="group relative flex items-center justify-between gap-2 py-1.5 hover:bg-emerald-500/[0.06] -mx-2 px-2 rounded transition-all duration-200 ease-out hover:translate-x-0.5"
                  >
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] font-mono tabular-nums text-muted-foreground/60 w-3">{idx + 1}</span>
                      <span className="text-sm font-semibold group-hover:text-emerald-500 transition-colors">{t.symbol.replace('USDT', '')}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <SparklineBars pct={t.changePct} className="text-emerald-500" />
                      <span className="text-sm font-bold text-emerald-500 tabular-nums">+{t.changePct.toFixed(2)}%</span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 ring-1 ring-inset ring-border/30 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ArrowDownRight className="h-4 w-4 text-rose-500" /> Top Losers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {moversQ.isLoading ? (
                Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 rounded bg-muted/40 animate-pulse" />)
              ) : (
                losers.slice(0, 5).map((t, idx) => (
                  <Link
                    key={t.symbol}
                    href={`/crypto/${encodeURIComponent(t.symbol)}`}
                    className="group relative flex items-center justify-between gap-2 py-1.5 hover:bg-rose-500/[0.06] -mx-2 px-2 rounded transition-all duration-200 ease-out hover:translate-x-0.5"
                  >
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-r-full bg-rose-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[9px] font-mono tabular-nums text-muted-foreground/60 w-3">{idx + 1}</span>
                      <span className="text-sm font-semibold group-hover:text-rose-500 transition-colors">{t.symbol.replace('USDT', '')}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <SparklineBars pct={t.changePct} className="text-rose-500" />
                      <span className="text-sm font-bold text-rose-500 tabular-nums">{t.changePct.toFixed(2)}%</span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Feature modules preview */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { title: 'Deep Analysis', desc: '7-layer analysis: technical, order flow, on-chain, sentiment, macro, fundamental, inter-market', icon: Activity, href: '/crypto', tint: 'from-emerald-500/15 via-emerald-500/[0.04] to-transparent' },
          { title: 'Live Signals', desc: 'AI consensus engine fuses multi-model outputs into conviction-scored trade signals', icon: TrendingUp, href: '/signals', tint: 'from-teal-500/15 via-teal-500/[0.04] to-transparent' },
          { title: 'News & Sentiment', desc: 'Real-time financial news with LLM sentiment + impact scoring', icon: Zap, href: '/news', tint: 'from-amber-500/15 via-amber-500/[0.04] to-transparent' },
          { title: 'Configuration', desc: 'Wire any LLM to any module — Gemini, Groq, NVIDIA NIM, Mistral, OpenRouter', icon: Bitcoin, href: '/settings', tint: 'from-orange-500/15 via-orange-500/[0.04] to-transparent' },
        ].map((f, i) => {
          const Icon = f.icon;
          return (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.3 }}
              className="h-full"
            >
              <Link href={f.href} aria-label={f.title} className="block h-full focus-visible:outline-none">
                <Card className="group relative h-full overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:border-emerald-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 ease-out cursor-pointer">
                  {/* Gradient overlay */}
                  <div aria-hidden className={`absolute inset-0 bg-gradient-to-br ${f.tint} opacity-80 transition-opacity duration-300 group-hover:opacity-100`} />
                  {/* Slide-in chevron */}
                  <ChevronRight className="absolute top-5 right-4 h-4 w-4 text-muted-foreground/40 opacity-0 -translate-x-1 transition-all duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-emerald-500" />
                  <CardContent className="relative p-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/25 to-teal-500/10 text-emerald-500 mb-3 ring-1 ring-inset ring-emerald-500/20 transition-all duration-200 ease-out group-hover:scale-110 group-hover:rotate-3 group-hover:shadow-md group-hover:shadow-emerald-500/20">
                      <Icon className="h-5 w-5 transition-transform duration-200" />
                    </div>
                    <h3 className="font-semibold text-sm mb-1 text-balance">{f.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed text-pretty">{f.desc}</p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Tiny inline sparkline bars for the gainers/losers list — gives a visual
// hint of magnitude without needing historical kline data in this view.
function SparklineBars({ pct, className }: { pct: number; className?: string }) {
  const up = pct >= 0;
  const magnitude = Math.min(1, Math.abs(pct) / 15); // cap at 15% for full bar
  const bars = Array.from({ length: 5 }, (_, i) => {
    const base = 0.3 + (i / 4) * 0.5;
    const wobble = (Math.sin(i * 1.7 + Math.abs(pct)) + 1) / 2;
    return Math.min(1, base + wobble * 0.3 + magnitude * 0.2);
  });
  return (
    <span aria-hidden className={`flex items-end gap-0.5 h-3 select-none ${className ?? ''}`}>
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-0.5 rounded-sm transition-all duration-300 ${up ? 'bg-emerald-500' : 'bg-rose-500'}`}
          style={{ height: `${Math.max(20, Math.min(100, h * 100))}%`, opacity: 0.45 + i * 0.1 }}
        />
      ))}
    </span>
  );
}
