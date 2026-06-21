'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Globe2, Search, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shape
// ---------------------------------------------------------------------------

type AssetClass = 'forex' | 'stocks' | 'indices' | 'commodities';

interface MarketQuote {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change?: number;
  changePercent?: number;
  previousClose?: number;
  currency?: string;
  fetchedAt: number;
}

interface Envelope {
  success?: boolean;
  data?: MarketQuote[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPrice(n: number, currency?: string): string {
  if (!Number.isFinite(n)) return '—';
  const prefix = currency && currency !== 'USD' ? `${currency} ` : '$';
  if (n >= 1000) return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `${prefix}${n.toFixed(2)}`;
  return `${prefix}${n.toFixed(4)}`;
}

const CLASS_LABEL: Record<AssetClass, string> = {
  forex: 'Forex',
  stocks: 'Stocks',
  indices: 'Indices',
  commodities: 'Commodities',
};

const CLASS_ACCENT: Record<AssetClass, string> = {
  forex: 'text-sky-300',
  stocks: 'text-violet-300',
  indices: 'text-amber-300',
  commodities: 'text-emerald-300',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MarketsClient(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<'all' | AssetClass>('all');

  const quotesQ = useQuery<MarketQuote[]>({
    queryKey: ['markets-quotes'],
    queryFn: async () => {
      const res = await fetch('/api/markets/quotes');
      if (!res.ok) throw new Error('markets quotes fetch failed');
      const json: Envelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  const allQuotes = quotesQ.data ?? [];

  const filtered = React.useMemo(() => {
    let out = allQuotes;
    if (tab !== 'all') out = out.filter((q) => q.assetClass === tab);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter(
        (m) =>
          m.symbol.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      );
    }
    return out;
  }, [allQuotes, tab, query]);

  const counts = React.useMemo(() => {
    const c: Record<string, number> = { all: allQuotes.length };
    for (const q of allQuotes) c[q.assetClass] = (c[q.assetClass] ?? 0) + 1;
    return c;
  }, [allQuotes]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Globe2 className="h-6 w-6 text-primary" />
            Global Markets
          </h1>
          <p className="text-xs text-muted-foreground">
            Forex · Stocks · Indices · Commodities — Yahoo Finance real-time quotes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symbol or name…"
              className="h-9 w-56 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void quotesQ.refetch()}
            disabled={quotesQ.isFetching}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', quotesQ.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All ({counts.all ?? 0})</TabsTrigger>
          <TabsTrigger value="forex">Forex ({counts.forex ?? 0})</TabsTrigger>
          <TabsTrigger value="stocks">Stocks ({counts.stocks ?? 0})</TabsTrigger>
          <TabsTrigger value="indices">Indices ({counts.indices ?? 0})</TabsTrigger>
          <TabsTrigger value="commodities">Commodities ({counts.commodities ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{tab === 'all' ? 'All Assets' : CLASS_LABEL[tab as AssetClass]}</span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {filtered.length} symbols · auto-refresh 2m
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Class</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">Change</th>
                      <th className="px-3 py-2 text-right">24h %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotesQ.isLoading ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          Loading market quotes…
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                          No symbols match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((m) => {
                        const positive = (m.changePercent ?? 0) >= 0;
                        return (
                          <tr
                            key={m.symbol}
                            className="border-b border-border/50 transition-colors hover:bg-muted/30"
                          >
                            <td className="px-3 py-2">
                              <Link
                                href={`/markets/${encodeURIComponent(m.symbol)}`}
                                className="font-medium text-foreground hover:text-primary"
                              >
                                {m.symbol}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{m.name}</td>
                            <td className="px-3 py-2">
                              <Badge variant="muted" className={cn('text-[10px]', CLASS_ACCENT[m.assetClass])}>
                                {CLASS_LABEL[m.assetClass]}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-foreground">
                              {fmtPrice(m.price, m.currency)}
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right font-mono',
                                positive ? 'text-emerald-400' : 'text-rose-400',
                              )}
                            >
                              {m.change != null
                                ? `${positive ? '+' : ''}${m.change.toFixed(m.change >= 100 ? 2 : 4)}`
                                : '—'}
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
                                {(m.changePercent ?? 0).toFixed(2)}%
                              </span>
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
