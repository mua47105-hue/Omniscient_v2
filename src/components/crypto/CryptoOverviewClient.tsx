'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StatCard } from '@/components/dashboard/StatCard';
import { AssetTable } from '@/components/dashboard/AssetTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, TrendingUp, Percent, Layers, AlertCircle, ArrowUpRight, ArrowDownRight, Star, RefreshCw, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Ticker, ApiResult } from '@/lib/types';

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j: ApiResult<T> = await r.json();
  if (!j.success) throw new Error(j.error || 'request failed');
  return j.data as T;
}

export function CryptoOverviewClient() {
  const pricesQ = useQuery({
    queryKey: ['crypto-prices'],
    queryFn: () => fetchJson<Ticker[]>('/api/crypto/prices'),
    refetchInterval: 30_000,
  });
  const moversQ = useQuery({
    queryKey: ['crypto-movers'],
    queryFn: () => fetchJson<{ gainers: Ticker[]; losers: Ticker[] }>('/api/crypto/movers'),
    refetchInterval: 60_000,
  });

  // "Last updated Xs ago" — live timer based on the last successful fetch.
  const [lastUpdatedAgo, setLastUpdatedAgo] = useState<string>('just now');
  const lastFetchedAt = pricesQ.dataUpdatedAt;
  useEffect(() => {
    if (!lastFetchedAt) return;
    const update = () => {
      const secs = Math.max(0, Math.floor((Date.now() - lastFetchedAt) / 1000));
      if (secs < 5) setLastUpdatedAgo('just now');
      else if (secs < 60) setLastUpdatedAgo(`${secs}s ago`);
      else setLastUpdatedAgo(`${Math.floor(secs / 60)}m ${secs % 60}s ago`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  const tickers = pricesQ.data ?? [];
  const gainers = moversQ.data?.gainers ?? [];
  const losers = moversQ.data?.losers ?? [];

  const totalVol = tickers.reduce((s, t) => s + t.quoteVolume, 0);
  const avgChange = tickers.length ? tickers.reduce((s, t) => s + t.changePct, 0) / tickers.length : 0;
  const upCount = tickers.filter((t) => t.changePct > 0).length;
  const breadth = tickers.length ? Math.round((upCount / tickers.length) * 100) : 0;

  const toRows = (arr: Ticker[]) =>
    arr.map((t) => ({
      symbol: t.symbol,
      price: t.price,
      changePct: t.changePct,
      quoteVolume: t.quoteVolume,
    }));

  return (
    <div className="space-y-6">
      {/* Page heading */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-1"
      >
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Crypto Markets</h1>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-500">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Real-time Binance market data · Deep multi-layer AI analysis · Click any asset for full breakdown
        </p>
      </motion.div>

      {/* Stats strip */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="24h Volume Tracked"
          value={totalVol >= 1e9 ? `$${(totalVol / 1e9).toFixed(2)}B` : totalVol >= 1e6 ? `$${(totalVol / 1e6).toFixed(0)}M` : '—'}
          subtitle={`${tickers.length} assets`}
          icon={<TrendingUp className="h-4 w-4" />}
          accent="emerald"
        />
        <StatCard
          title="Avg 24h Change"
          value={`${avgChange > 0 ? '+' : ''}${avgChange.toFixed(2)}%`}
          change={avgChange}
          icon={<Percent className="h-4 w-4" />}
          accent={avgChange >= 0 ? 'emerald' : 'rose'}
        />
        <StatCard
          title="Market Breadth"
          value={`${breadth}%`}
          subtitle={`${upCount}/${tickers.length} up`}
          icon={<Activity className="h-4 w-4" />}
          accent={breadth >= 50 ? 'emerald' : 'rose'}
        />
        <StatCard
          title="Top Gainer"
          value={gainers[0] ? `${gainers[0].symbol.replace('USDT', '')}` : '—'}
          change={gainers[0]?.changePct}
          subtitle={gainers[0] ? `$${gainers[0].price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : undefined}
          icon={<Layers className="h-4 w-4" />}
          accent="emerald"
        />
      </div>

      {/* Tabs: Watchlist / Gainers / Losers */}
      <Tabs defaultValue="watchlist" className="w-full">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <TabsList className="bg-muted/60 backdrop-blur-sm p-1 gap-0.5">
            <TabsTrigger
              value="watchlist"
              className="gap-1.5 transition-all duration-200 ease-out data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm hover:bg-muted"
            >
              <Star className="h-3.5 w-3.5" /> Watchlist
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-muted-foreground/15 px-1.5 py-0 text-[9px] font-bold tabular-nums leading-tight min-w-[16px]">
                {tickers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="gainers"
              className="gap-1.5 transition-all duration-200 ease-out data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:shadow-sm hover:bg-muted"
            >
              <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" /> Top Gainers
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0 text-[9px] font-bold tabular-nums leading-tight min-w-[16px]">
                {gainers.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="losers"
              className="gap-1.5 transition-all duration-200 ease-out data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-600 dark:data-[state=active]:text-rose-400 data-[state=active]:shadow-sm hover:bg-muted"
            >
              <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" /> Top Losers
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 px-1.5 py-0 text-[9px] font-bold tabular-nums leading-tight min-w-[16px]">
                {losers.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* Last-updated timestamp + manual refresh */}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>
              Last updated{' '}
              <span className="text-foreground font-medium tabular-nums">{lastUpdatedAgo}</span>
            </span>
            {pricesQ.isFetching && (
              <span className="flex items-center gap-1 text-emerald-500">
                <RefreshCw className="h-3 w-3 animate-spin" />
                syncing
              </span>
            )}
          </div>
        </div>

        <TabsContent value="watchlist" className="mt-4">
          <Card className="border-border/60 ring-1 ring-inset ring-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Star className="h-4 w-4 text-emerald-500" /> Your Watchlist
                </span>
                <span className="text-xs font-normal text-muted-foreground">Auto-refreshes every 30s</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {pricesQ.isLoading && tickers.length === 0 ? (
                <TableSkeleton />
              ) : pricesQ.isError && tickers.length === 0 ? (
                <ErrorState message="Failed to load market data" />
              ) : (
                <AssetTable rows={toRows(tickers)} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gainers" className="mt-4">
          <Card className="border-border/60 ring-1 ring-inset ring-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 text-emerald-500" /> Top Gainers (24h)
                </span>
                <span className="text-xs font-normal text-muted-foreground">Refreshes every 60s</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {moversQ.isLoading && gainers.length === 0 ? (
                <TableSkeleton />
              ) : moversQ.isError && gainers.length === 0 ? (
                <ErrorState message="Failed to load movers" />
              ) : (
                <AssetTable rows={toRows(gainers)} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="losers" className="mt-4">
          <Card className="border-border/60 ring-1 ring-inset ring-border/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ArrowDownRight className="h-4 w-4 text-rose-500" /> Top Losers (24h)
                </span>
                <span className="text-xs font-normal text-muted-foreground">Refreshes every 60s</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {moversQ.isLoading && losers.length === 0 ? (
                <TableSkeleton />
              ) : moversQ.isError && losers.length === 0 ? (
                <ErrorState message="Failed to load movers" />
              ) : (
                <AssetTable rows={toRows(losers)} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-rose-500">
      <AlertCircle className="h-5 w-5" />
      <span>{message}</span>
      <span className="text-xs text-muted-foreground">Will retry automatically</span>
    </div>
  );
}
