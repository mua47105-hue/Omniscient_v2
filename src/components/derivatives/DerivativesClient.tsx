'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers3, RefreshCw, TrendingUp, TrendingDown, Activity, Gauge } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

interface FundingRow {
  symbol: string;
  fundingRate: number;
  markPrice?: number;
  nextFundingTime?: number;
  name?: string;
  openInterest?: number | null;
}

interface FundingEnvelope {
  success?: boolean;
  data?: FundingRow[];
}

interface DerivativesV2Lite {
  currency: 'BTC' | 'ETH';
  spot: number;
  basisTermStructure: { expiry: string; basisPct: number; futurePrice: number }[];
  basis: number;
  riskReversal25Delta: {
    callIv?: number;
    putIv?: number;
    riskReversal: number;
    callStrike?: number;
    putStrike?: number;
    expiry?: string;
  };
  dvol: number;
  realizedVol: number;
  vrp: number;
  regime: 'CAPITULATION' | 'NEUTRAL' | 'EUPHORIA';
  rationale: string;
  asOf: number;
  fromCache: boolean;
  errors: string[];
}

interface DerivativesV2Envelope {
  success?: boolean;
  data?: DerivativesV2Lite;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

function fmtNum(n: number | undefined | null, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B${suffix}`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M${suffix}`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k${suffix}`;
  return `${n.toFixed(0)}${suffix}`;
}

function regimeBadge(regime: string): { variant: 'success' | 'warning' | 'rose'; label: string } {
  if (regime === 'CAPITULATION') return { variant: 'rose', label: 'CAPITULATION' };
  if (regime === 'EUPHORIA') return { variant: 'warning', label: 'EUPHORIA' };
  return { variant: 'success', label: 'NEUTRAL' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DerivativesClient(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [tab, setTab] = React.useState<'funding' | 'derivativesV2'>('funding');

  const fundingQ = useQuery<FundingRow[]>({
    queryKey: ['derivatives-funding-all'],
    queryFn: async () => {
      const res = await fetch('/api/derivatives/funding-all');
      if (!res.ok) throw new Error('funding fetch failed');
      const json: FundingEnvelope = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const btcDerivQ = useQuery<DerivativesV2Lite>({
    queryKey: ['derivatives-v2', 'BTC'],
    queryFn: async () => {
      const res = await fetch('/api/analysis/derivatives-v2?currency=BTC');
      if (!res.ok) throw new Error('BTC derivatives-v2 fetch failed');
      const json: DerivativesV2Envelope = await res.json();
      if (!json.data) throw new Error('empty BTC derivatives-v2');
      return json.data;
    },
    staleTime: 8 * 60 * 60_000, // 8h cache upstream
  });

  const ethDerivQ = useQuery<DerivativesV2Lite>({
    queryKey: ['derivatives-v2', 'ETH'],
    queryFn: async () => {
      const res = await fetch('/api/analysis/derivatives-v2?currency=ETH');
      if (!res.ok) throw new Error('ETH derivatives-v2 fetch failed');
      const json: DerivativesV2Envelope = await res.json();
      if (!json.data) throw new Error('empty ETH derivatives-v2');
      return json.data;
    },
    staleTime: 8 * 60 * 60_000,
  });

  const allFunding = fundingQ.data ?? [];

  // Filter + sort the funding table.
  const filteredFunding = React.useMemo(() => {
    let out = allFunding;
    if (query.trim()) {
      const q = query.trim().toUpperCase();
      out = out.filter((f) => f.symbol.includes(q) || (f.name ?? '').toUpperCase().includes(q));
    }
    // Sort by |funding rate| desc — most interesting extremes first.
    return [...out].sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  }, [allFunding, query]);

  // Stats
  const stats = React.useMemo(() => {
    if (allFunding.length === 0) return { total: 0, positive: 0, negative: 0, avg: 0, max: 0, min: 0, totalOI: 0 };
    const positive = allFunding.filter((f) => f.fundingRate > 0).length;
    const negative = allFunding.filter((f) => f.fundingRate < 0).length;
    const avg = allFunding.reduce((s, f) => s + f.fundingRate, 0) / allFunding.length;
    const max = allFunding.reduce((m, f) => (f.fundingRate > m ? f.fundingRate : m), -Infinity);
    const min = allFunding.reduce((m, f) => (f.fundingRate < m ? f.fundingRate : m), Infinity);
    const totalOI = allFunding.reduce((s, f) => s + (f.openInterest ?? 0), 0);
    return { total: allFunding.length, positive, negative, avg, max, min, totalOI };
  }, [allFunding]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Layers3 className="h-6 w-6 text-primary" />
            Derivatives
          </h1>
          <p className="text-xs text-muted-foreground">
            Funding rates + open interest across all Binance perpetuals · E4 derivatives-v2 regime for BTC/ETH.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void fundingQ.refetch();
            void btcDerivQ.refetch();
            void ethDerivQ.refetch();
          }}
          disabled={fundingQ.isFetching}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', fundingQ.isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total Perps
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{stats.total}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Positive Funding
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {stats.positive} <span className="text-[10px] font-normal text-muted-foreground">(longs pay)</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Negative Funding
          </div>
          <div className="mt-1 text-xl font-bold text-rose-300">
            {stats.negative} <span className="text-[10px] font-normal text-muted-foreground">(shorts pay)</span>
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total Open Interest
          </div>
          <div className="mt-1 text-xl font-bold text-amber-300">{fmtNum(stats.totalOI)}</div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="funding">Funding Rates</TabsTrigger>
          <TabsTrigger value="derivativesV2">E4 Derivatives-v2 (BTC/ETH)</TabsTrigger>
        </TabsList>

        {/* Funding rates tab */}
        <TabsContent value="funding" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Funding Rates (sorted by |rate|)</span>
                <div className="relative">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter…"
                    className="h-8 w-48 text-xs"
                  />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-right">Funding</th>
                      <th className="px-3 py-2 text-right">Mark Price</th>
                      <th className="px-3 py-2 text-right">Open Interest</th>
                      <th className="px-3 py-2 text-left">Bias</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fundingQ.isLoading ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          Loading funding rates…
                        </td>
                      </tr>
                    ) : filteredFunding.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                          No matching perps.
                        </td>
                      </tr>
                    ) : (
                      filteredFunding.slice(0, 60).map((f) => {
                        const positive = f.fundingRate >= 0;
                        const extreme = Math.abs(f.fundingRate) > 0.0005; // > 0.05%
                        return (
                          <tr
                            key={f.symbol}
                            className={cn(
                              'border-b border-border/50 transition-colors hover:bg-muted/30',
                              extreme && (positive ? 'bg-emerald-500/5' : 'bg-rose-500/5'),
                            )}
                          >
                            <td className="px-3 py-2">
                              <div className="flex flex-col">
                                <span className="font-medium text-foreground">
                                  {f.symbol.replace(/USDT$/, '')}
                                </span>
                                <span className="text-[10px] text-muted-foreground">{f.symbol}</span>
                              </div>
                            </td>
                            <td
                              className={cn(
                                'px-3 py-2 text-right font-mono',
                                positive ? 'text-emerald-400' : 'text-rose-400',
                              )}
                            >
                              {fmtPct(f.fundingRate)}
                              {extreme ? <span className="ml-1">⚠️</span> : null}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                              {f.markPrice ? `$${f.markPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                              {fmtNum(f.openInterest)}
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant={positive ? 'success' : 'rose'} className="text-[9px]">
                                {positive ? (
                                  <>
                                    <TrendingUp className="h-2.5 w-2.5" /> longs pay
                                  </>
                                ) : (
                                  <>
                                    <TrendingDown className="h-2.5 w-2.5" /> shorts pay
                                  </>
                                )}
                              </Badge>
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

        {/* Derivatives-v2 tab */}
        <TabsContent value="derivativesV2" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <DerivativesV2Card
              currency="BTC"
              query={btcDerivQ}
            />
            <DerivativesV2Card
              currency="ETH"
              query={ethDerivQ}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DerivativesV2Card — E4 regime panel for BTC/ETH
// ---------------------------------------------------------------------------

function DerivativesV2Card({
  currency,
  query,
}: {
  currency: 'BTC' | 'ETH';
  query: ReturnType<typeof useQuery<DerivativesV2Lite>>;
}): React.ReactElement {
  if (query.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-amber-300" />
            {currency} · E4 Derivatives-v2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-6 text-center text-xs text-muted-foreground">
            Fetching basis + skew + VRP from Deribit + Binance COIN-M…
          </p>
        </CardContent>
      </Card>
    );
  }

  if (query.error || !query.data) {
    return (
      <Card className="ring-1 ring-rose-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-rose-300" />
            {currency} · E4 Derivatives-v2
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-4 text-center text-xs text-rose-300">
            {query.error?.message ?? 'No data — upstream Deribit/Binance call failed.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const d = query.data;
  const reg = regimeBadge(d.regime);

  return (
    <Card className={cn(
      'ring-1',
      d.regime === 'CAPITULATION'
        ? 'ring-rose-500/40'
        : d.regime === 'EUPHORIA'
          ? 'ring-amber-500/40'
          : 'ring-emerald-500/30',
    )}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-amber-300" />
            {currency} · E4 Derivatives-v2
          </span>
          <Badge variant={reg.variant}>{reg.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Spot */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Spot</div>
            <div className="font-mono text-sm text-foreground">${d.spot.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">DVOL</div>
            <div className="font-mono text-sm text-amber-300">{d.dvol.toFixed(0)}</div>
          </div>
        </div>

        {/* Basis + RR + VRP */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Basis</div>
            <div className={cn('font-mono text-sm', d.basis >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              {d.basis.toFixed(2)}%
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">RR 25Δ</div>
            <div className={cn('font-mono text-sm', d.riskReversal25Delta.riskReversal >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              {d.riskReversal25Delta.riskReversal.toFixed(1)}
            </div>
          </div>
          <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">VRP</div>
            <div className={cn('font-mono text-sm', d.vrp >= 0 ? 'text-amber-300' : 'text-sky-300')}>
              {d.vrp.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Realized vol */}
        <div className="flex items-center justify-between border-t border-border/40 pt-2 text-[11px]">
          <span className="text-muted-foreground">Realized Vol (30d, annualized)</span>
          <span className="font-mono text-foreground">{(d.realizedVol * 100).toFixed(0)}%</span>
        </div>

        {/* Basis term structure */}
        {d.basisTermStructure.length > 0 ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Basis Term Structure
            </div>
            <div className="space-y-1">
              {d.basisTermStructure.map((b, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Quarterly {b.expiry}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-foreground">${b.futurePrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    <span className={cn('font-mono', b.basisPct >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                      {b.basisPct >= 0 ? '+' : ''}{b.basisPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* RR detail */}
        {d.riskReversal25Delta.callIv != null || d.riskReversal25Delta.putIv != null ? (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              25Δ Risk Reversal ({d.riskReversal25Delta.expiry ?? '—'})
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Call IV</span>
                <span className="font-mono text-emerald-300">{d.riskReversal25Delta.callIv?.toFixed(1) ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Put IV</span>
                <span className="font-mono text-rose-300">{d.riskReversal25Delta.putIv?.toFixed(1) ?? '—'}</span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Rationale */}
        <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Rationale:</span> {d.rationale}
        </div>

        {/* Errors */}
        {d.errors.length > 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-300">
            <span className="font-medium">Warnings:</span> {d.errors.join('; ')}
          </div>
        ) : null}

        <div className="flex items-center justify-end text-[9px] text-muted-foreground">
          <Activity className="mr-1 h-2.5 w-2.5" />
          {d.fromCache ? 'cached' : 'fresh'} · {new Date(d.asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </CardContent>
    </Card>
  );
}
