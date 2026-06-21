'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Flame, TrendingUp, TrendingDown, RefreshCw, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

type AssetClass = 'crypto' | 'forex' | 'stocks' | 'indices' | 'commodities';

interface HeatMapEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  changePercent: number;
  price: number;
  marketCap?: number;
  volume?: number;
}

interface Envelope {
  success?: boolean;
  data?: HeatMapEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heat-map tile color:
 *   - deep green = strong up (>3%)
 *   - green      = up (0.5..3%)
 *   - neutral    = flat (-0.5..0.5%)
 *   - red        = down (-3..-0.5%)
 *   - deep red   = strong down (<-3%)
 *
 * Returns inline-style backgroundColor + textColor for direct use.
 */
function heatColor(pct: number): { bg: string; fg: string; border: string } {
  if (pct >= 5) return { bg: 'oklch(0.45 0.20 150 / 0.85)', fg: 'oklch(0.98 0.02 150)', border: 'oklch(0.55 0.20 150)' };
  if (pct >= 2) return { bg: 'oklch(0.55 0.18 150 / 0.7)', fg: 'oklch(0.98 0.02 150)', border: 'oklch(0.65 0.18 150)' };
  if (pct >= 0.5) return { bg: 'oklch(0.65 0.13 150 / 0.45)', fg: 'oklch(0.85 0.13 150)', border: 'oklch(0.55 0.13 150)' };
  if (pct > -0.5) return { bg: 'oklch(0.30 0.012 264 / 0.6)', fg: 'oklch(0.70 0.012 264)', border: 'oklch(0.35 0.012 264)' };
  if (pct > -2) return { bg: 'oklch(0.65 0.18 25 / 0.45)', fg: 'oklch(0.85 0.13 25)', border: 'oklch(0.55 0.13 25)' };
  if (pct > -5) return { bg: 'oklch(0.55 0.22 25 / 0.7)', fg: 'oklch(0.98 0.02 25)', border: 'oklch(0.65 0.22 25)' };
  return { bg: 'oklch(0.45 0.24 25 / 0.85)', fg: 'oklch(0.98 0.02 25)', border: 'oklch(0.55 0.24 25)' };
}

/**
 * Tile size (flex-grow) based on market cap (crypto) or fixed sizing for others.
 * We map log(marketCap) to a flex weight so the biggest tiles are noticeably
 * larger without overwhelming the grid.
 */
function tileFlex(marketCap?: number, volume?: number): number {
  if (marketCap && marketCap > 0) {
    // log scale: 1B → 1, 100B → 2, 1T → 3
    const w = Math.log10(marketCap / 1e9);
    return Math.max(1, Math.min(6, w));
  }
  if (volume && volume > 0) {
    const w = Math.log10(volume / 1e6);
    return Math.max(1, Math.min(4, w / 2));
  }
  return 1;
}

const CLASS_LABEL: Record<AssetClass, string> = {
  crypto: 'Crypto',
  forex: 'Forex',
  stocks: 'Stocks',
  indices: 'Indices',
  commodities: 'Commodities',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HeatMapClient(): React.ReactElement {
  const [tab, setTab] = React.useState<'all' | AssetClass>('all');

  const heatmapQ = useQuery<HeatMapEntry[]>({
    queryKey: ['markets-heatmap'],
    queryFn: async () => {
      const res = await fetch('/api/markets/heatmap');
      if (!res.ok) throw new Error('heatmap fetch failed');
      const json: Envelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const all = heatmapQ.data ?? [];
  const filtered = React.useMemo(() => {
    const list = tab === 'all' ? all : all.filter((e) => e.assetClass === tab);
    // Sort by |change%| desc — most exciting tiles first.
    return [...list].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  }, [all, tab]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const e of all) c[e.assetClass] = (c[e.assetClass] ?? 0) + 1;
    return c;
  }, [all]);

  // Aggregate stats for the header.
  const stats = React.useMemo(() => {
    if (all.length === 0) return { avg: 0, gainers: 0, losers: 0, topGainer: null as HeatMapEntry | null, topLoser: null as HeatMapEntry | null };
    const avg = all.reduce((s, e) => s + e.changePercent, 0) / all.length;
    const gainers = all.filter((e) => e.changePercent > 0).length;
    const losers = all.filter((e) => e.changePercent < 0).length;
    const topGainer = all.reduce((m, e) => (e.changePercent > (m?.changePercent ?? -Infinity) ? e : m), null as HeatMapEntry | null);
    const topLoser = all.reduce((m, e) => (e.changePercent < (m?.changePercent ?? Infinity) ? e : m), null as HeatMapEntry | null);
    return { avg, gainers, losers, topGainer, topLoser };
  }, [all]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Flame className="h-6 w-6 text-amber-400" />
            Market Heat Map
          </h1>
          <p className="text-xs text-muted-foreground">
            Color-coded performance grid · green = up, red = down, size by market cap.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void heatmapQ.refetch()}
          disabled={heatmapQ.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', heatmapQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Aggregate stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Avg Change
          </div>
          <div
            className={cn(
              'mt-1 text-xl font-bold',
              stats.avg >= 0 ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {stats.avg >= 0 ? '+' : ''}
            {stats.avg.toFixed(2)}%
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Gainers / Losers
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">
            <span className="text-emerald-400">{stats.gainers}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-rose-400">{stats.losers}</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Top Gainer
          </div>
          <div className="mt-1 truncate text-sm font-bold text-emerald-300">
            {stats.topGainer ? (
              <Link href={`/crypto/${stats.topGainer.symbol.replace(/USDT$/, '')}`}>
                {stats.topGainer.symbol.replace(/USDT$/, '')}
                <span className="ml-1 font-mono text-emerald-400">
                  +{stats.topGainer.changePercent.toFixed(2)}%
                </span>
              </Link>
            ) : '—'}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Top Loser
          </div>
          <div className="mt-1 truncate text-sm font-bold text-rose-300">
            {stats.topLoser ? (
              <Link href={`/crypto/${stats.topLoser.symbol.replace(/USDT$/, '')}`}>
                {stats.topLoser.symbol.replace(/USDT$/, '')}
                <span className="ml-1 font-mono text-rose-400">
                  {stats.topLoser.changePercent.toFixed(2)}%
                </span>
              </Link>
            ) : '—'}
          </div>
        </Card>
      </div>

      {/* Asset class tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All ({counts.all ?? 0})</TabsTrigger>
          <TabsTrigger value="crypto">Crypto ({counts.crypto ?? 0})</TabsTrigger>
          <TabsTrigger value="forex">Forex ({counts.forex ?? 0})</TabsTrigger>
          <TabsTrigger value="stocks">Stocks ({counts.stocks ?? 0})</TabsTrigger>
          <TabsTrigger value="indices">Indices ({counts.indices ?? 0})</TabsTrigger>
          <TabsTrigger value="commodities">Commodities ({counts.commodities ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                {tab === 'all' ? 'All Assets' : CLASS_LABEL[tab as AssetClass]} ·{' '}
                {filtered.length} tiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              {heatmapQ.isLoading ? (
                <div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">
                  Loading heat map…
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex h-[300px] items-center justify-center text-xs text-muted-foreground">
                  No assets to display.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filtered.map((e) => {
                    const c = heatColor(e.changePercent);
                    const flex = tileFlex(e.marketCap, e.volume);
                    const href =
                      e.assetClass === 'crypto'
                        ? `/crypto/${e.symbol.replace(/USDT$/, '')}`
                        : `/markets/${encodeURIComponent(e.symbol)}`;
                    return (
                      <Link
                        key={`${e.assetClass}-${e.symbol}`}
                        href={href}
                        title={`${e.name} (${e.symbol}) — ${e.changePercent.toFixed(2)}%`}
                        className="group relative flex min-w-[90px] flex-col justify-between rounded-md border p-2 transition-all hover:scale-[1.04] hover:z-10 hover:shadow-lg"
                        style={{
                          backgroundColor: c.bg,
                          borderColor: c.border,
                          color: c.fg,
                          flexGrow: flex,
                          flexBasis: `${90 + flex * 20}px`,
                        }}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="truncate text-[11px] font-bold tracking-tight">
                            {e.assetClass === 'crypto'
                              ? e.symbol.replace(/USDT$/, '')
                              : e.symbol.replace(/[=^]/g, '').replace(/=X$/, '')}
                          </span>
                          {e.changePercent >= 0 ? (
                            <TrendingUp className="h-3 w-3 shrink-0 opacity-80" />
                          ) : (
                            <TrendingDown className="h-3 w-3 shrink-0 opacity-80" />
                          )}
                        </div>
                        <div className="mt-1 font-mono text-[13px] font-bold">
                          {e.changePercent >= 0 ? '+' : ''}
                          {e.changePercent.toFixed(2)}%
                        </div>
                        <div className="mt-0.5 truncate text-[9px] opacity-80">
                          {e.name}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <LegendSwatch pct={-6} label="≤ -5%" />
            <LegendSwatch pct={-3} label="-5% to -2%" />
            <LegendSwatch pct={-1} label="-2% to -0.5%" />
            <LegendSwatch pct={0} label="flat (±0.5%)" />
            <LegendSwatch pct={1} label="+0.5% to +2%" />
            <LegendSwatch pct={3} label="+2% to +5%" />
            <LegendSwatch pct={6} label="≥ +5%" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function LegendSwatch({ pct, label }: { pct: number; label: string }): React.ReactElement {
  const c = heatColor(pct);
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="h-4 w-8 rounded-sm border"
        style={{ backgroundColor: c.bg, borderColor: c.border }}
      />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
