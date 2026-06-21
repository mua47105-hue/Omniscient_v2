'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search, ArrowUpDown, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shapes — { success: true, data: Ticker[] }
// ---------------------------------------------------------------------------

interface TickerLite {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  fetchedAt: number;
}

interface Envelope {
  success?: boolean;
  data?: TickerLite[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
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

// ---------------------------------------------------------------------------
// Sort + filter state
// ---------------------------------------------------------------------------

type SortKey = 'symbol' | 'lastPrice' | 'priceChangePercent' | 'quoteVolume';
type SortDir = 'asc' | 'desc';

function SortHeader({
  label,
  k,
  active,
  onToggle,
}: {
  label: string;
  k: SortKey;
  active: boolean;
  onToggle: (k: SortKey) => void;
}): React.ReactElement {
  return (
    <button
      onClick={() => onToggle(k)}
      className={cn(
        'inline-flex items-center gap-1 transition-colors hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CryptoOverviewClient(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [sortKey, setSortKey] = React.useState<SortKey>('quoteVolume');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');

  const pricesQ = useQuery<TickerLite[]>({
    queryKey: ['crypto-prices-overview'],
    queryFn: async () => {
      const res = await fetch('/api/crypto/prices');
      if (!res.ok) throw new Error('prices fetch failed');
      const json: Envelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const moversQ = useQuery<TickerLite[]>({
    queryKey: ['crypto-movers-overview'],
    queryFn: async () => {
      const res = await fetch('/api/crypto/movers');
      if (!res.ok) throw new Error('movers fetch failed');
      const json: Envelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const prices = pricesQ.data ?? [];
  const movers = moversQ.data ?? [];
  const gainers = movers.filter((m) => m.priceChangePercent > 0).slice(0, 8);
  const losers = movers.filter((m) => m.priceChangePercent < 0).slice(0, 8);

  const filtered = React.useMemo(() => {
    let out = prices;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      out = out.filter((t) => t.symbol.includes(q));
    }
    out = [...out].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return out;
  }, [prices, query, sortKey, sortDir]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Crypto Markets
          </h1>
          <p className="text-xs text-muted-foreground">
            Live Binance perpetual futures — prices, 24h change, volume, and top movers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol…"
              className="h-9 w-48 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void pricesQ.refetch();
              void moversQ.refetch();
            }}
            disabled={pricesQ.isFetching}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', pricesQ.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Tracked Symbols" value={prices.length.toString()} accent="sky" />
        <StatTile
          label="Gainers"
          value={prices.filter((p) => p.priceChangePercent > 0).length.toString()}
          accent="emerald"
        />
        <StatTile
          label="Losers"
          value={prices.filter((p) => p.priceChangePercent < 0).length.toString()}
          accent="rose"
        />
        <StatTile
          label="24h Volume"
          value={fmtVol(prices.reduce((s, p) => s + (p.quoteVolume ?? 0), 0))}
          accent="amber"
        />
      </div>

      {/* Main grid — table + movers sidebar */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Live Prices</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {filtered.length} of {prices.length} · auto-refresh 30s
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 text-left">
                      <SortHeader label="Symbol" k="symbol" active={sortKey === 'symbol'} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader label="Price" k="lastPrice" active={sortKey === 'lastPrice'} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader label="24h %" k="priceChangePercent" active={sortKey === 'priceChangePercent'} onToggle={toggleSort} />
                    </th>
                    <th className="px-3 py-2 text-right">
                      <SortHeader label="Volume" k="quoteVolume" active={sortKey === 'quoteVolume'} onToggle={toggleSort} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pricesQ.isLoading ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                        Loading tickers…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                        No symbols match &quot;{query}&quot;
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, 60).map((t) => {
                      const positive = t.priceChangePercent >= 0;
                      const base = t.symbol.replace(/USDT$/, '');
                      return (
                        <tr
                          key={t.symbol}
                          className="border-b border-border/50 transition-colors hover:bg-muted/30"
                        >
                          <td className="px-3 py-2">
                            <Link
                              href={`/crypto/${base}`}
                              className="flex flex-col"
                            >
                              <span className="font-medium text-foreground hover:text-primary">
                                {base}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {t.symbol}
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">
                            ${fmtPrice(t.lastPrice)}
                          </td>
                          <td
                            className={cn(
                              'px-3 py-2 text-right font-mono',
                              positive ? 'text-emerald-400' : 'text-rose-400',
                            )}
                          >
                            <span className="inline-flex items-center gap-1 justify-end">
                              {positive ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {positive ? '+' : ''}
                              {t.priceChangePercent.toFixed(2)}%
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {fmtVol(t.quoteVolume)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-300">
                <TrendingUp className="h-4 w-4" />
                Top Gainers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MoverList rows={gainers} tone="emerald" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-rose-300">
                <TrendingDown className="h-4 w-4" />
                Top Losers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MoverList rows={losers} tone="rose" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'sky' | 'emerald' | 'rose' | 'amber';
}): React.ReactElement {
  const tone =
    accent === 'emerald'
      ? 'text-emerald-300'
      : accent === 'rose'
        ? 'text-rose-300'
        : accent === 'amber'
          ? 'text-amber-300'
          : 'text-sky-300';
  return (
    <Card className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn('mt-1 text-xl font-bold', tone)}>{value}</div>
    </Card>
  );
}

function MoverList({
  rows,
  tone,
}: {
  rows: TickerLite[];
  tone: 'emerald' | 'rose';
}): React.ReactElement {
  if (rows.length === 0) {
    return <p className="py-4 text-center text-[11px] text-muted-foreground">No movers yet</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const base = r.symbol.replace(/USDT$/, '');
        const positive = r.priceChangePercent >= 0;
        return (
          <Link
            key={r.symbol}
            href={`/crypto/${base}`}
            className="flex items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
          >
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">{base}</span>
              <span className="text-[10px] text-muted-foreground">${fmtPrice(r.lastPrice)}</span>
            </div>
            <Badge variant={positive ? 'success' : 'rose'} className="font-mono">
              {positive ? '+' : ''}
              {r.priceChangePercent.toFixed(2)}%
            </Badge>
          </Link>
        );
      })}
    </div>
  );
}
