'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitCompareArrows, RefreshCw, TrendingUp, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  computeCorrelationMatrix,
  type CorrelationMatrix,
} from '@/lib/analysis/correlation';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

interface ReturnsResponse {
  success?: boolean;
  data?: Record<string, number[]>;
  error?: string;
}

interface CointegrationEntry {
  pair: string;
  x: string;
  y: string;
  hedgeRatio: number;
  adfStat: number;
  pValue: number;
  isCointegrated: boolean;
  halfLife: number;
  zScore: number;
  tradeable: boolean;
  signal: 'long-spread' | 'short-spread' | 'flat';
}

interface CointegrationMatrix {
  assets: string[];
  entries: CointegrationEntry[];
  byPair: Record<string, CointegrationEntry>;
}

interface CointegrationResponse {
  success?: boolean;
  data?: CointegrationMatrix;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Color a correlation value: r=+1 → deep green, r=-1 → deep red, r=0 → dark.
 */
function corrColor(r: number): { bg: string; fg: string } {
  // r in [-1, 1]
  if (r >= 0.7) return { bg: 'oklch(0.45 0.20 150 / 0.85)', fg: 'oklch(0.98 0.02 150)' };
  if (r >= 0.4) return { bg: 'oklch(0.55 0.16 150 / 0.55)', fg: 'oklch(0.85 0.10 150)' };
  if (r >= 0.2) return { bg: 'oklch(0.65 0.10 150 / 0.30)', fg: 'oklch(0.85 0.05 150)' };
  if (r > -0.2) return { bg: 'oklch(0.30 0.012 264 / 0.45)', fg: 'oklch(0.70 0.012 264)' };
  if (r > -0.4) return { bg: 'oklch(0.65 0.10 25 / 0.30)', fg: 'oklch(0.85 0.05 25)' };
  if (r > -0.7) return { bg: 'oklch(0.55 0.16 25 / 0.55)', fg: 'oklch(0.85 0.10 25)' };
  return { bg: 'oklch(0.45 0.24 25 / 0.85)', fg: 'oklch(0.98 0.02 25)' };
}

function corrLabel(r: number): string {
  if (r >= 0.7) return 'strong +';
  if (r >= 0.4) return 'positive';
  if (r >= 0.2) return 'weak +';
  if (r > -0.2) return 'uncorrelated';
  if (r > -0.4) return 'weak -';
  if (r > -0.7) return 'negative';
  return 'strong -';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CorrelationMatrixClient(): React.ReactElement {
  const [mode, setMode] = React.useState<'correlation' | 'cointegration'>('correlation');

  // Returns for correlation matrix.
  const returnsQ = useQuery<Record<string, number[]>>({
    queryKey: ['correlation-returns'],
    queryFn: async () => {
      const res = await fetch('/api/correlation/returns');
      if (!res.ok) throw new Error('returns fetch failed');
      const json: ReturnsResponse = await res.json();
      if (!json.success || !json.data) throw new Error(json.error ?? 'returns error');
      return json.data;
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  // Cointegration matrix — uses /api/analysis/cointegration with all symbols.
  const symbols = React.useMemo(() => Object.keys(returnsQ.data ?? {}).sort(), [returnsQ.data]);
  const cointegrationQ = useQuery<CointegrationMatrix>({
    queryKey: ['cointegration-matrix', symbols.join(',')],
    queryFn: async () => {
      if (symbols.length < 2) {
        return { assets: [], entries: [], byPair: {} } as CointegrationMatrix;
      }
      const url = `/api/analysis/cointegration?symbols=${symbols.join(',')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('cointegration fetch failed');
      const json: CointegrationResponse = await res.json();
      if (!json.success || !json.data) throw new Error(json.error ?? 'cointegration error');
      return json.data;
    },
    enabled: mode === 'cointegration' && symbols.length >= 2,
    staleTime: 5 * 60_000,
  });

  // Build the Pearson correlation matrix on the client (cheap, n² × n_returns).
  const corrMatrix: CorrelationMatrix | null = React.useMemo(() => {
    if (!returnsQ.data || Object.keys(returnsQ.data).length < 2) return null;
    return computeCorrelationMatrix(returnsQ.data);
  }, [returnsQ.data]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <GitCompareArrows className="h-6 w-6 text-primary" />
            Correlation &amp; Cointegration
          </h1>
          <p className="text-xs text-muted-foreground">
            N×N Pearson correlation matrix (30d log-returns) + Engle-Granger cointegration toggle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList>
              <TabsTrigger value="correlation">Correlation</TabsTrigger>
              <TabsTrigger value="cointegration">Cointegration</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void returnsQ.refetch();
              void cointegrationQ.refetch();
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', returnsQ.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Assets Analyzed
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{symbols.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Pairs (N²)
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">
            {(symbols.length * (symbols.length - 1)) / 2}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Cointegrated
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-300">
            {cointegrationQ.data?.entries.filter((e) => e.isCointegrated).length ?? 0}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tradeable Spreads
          </div>
          <div className="mt-1 text-xl font-bold text-amber-300">
            {cointegrationQ.data?.entries.filter((e) => e.tradeable).length ?? 0}
          </div>
        </Card>
      </div>

      {mode === 'correlation' ? (
        <CorrelationTab
          isLoading={returnsQ.isLoading}
          error={returnsQ.error?.message}
          matrix={corrMatrix}
        />
      ) : (
        <CointegrationTab
          isLoading={cointegrationQ.isLoading || returnsQ.isLoading}
          error={cointegrationQ.error?.message ?? returnsQ.error?.message}
          matrix={cointegrationQ.data}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Correlation tab — N×N heatmap grid
// ---------------------------------------------------------------------------

function CorrelationTab({
  isLoading,
  error,
  matrix,
}: {
  isLoading: boolean;
  error?: string;
  matrix: CorrelationMatrix | null;
}): React.ReactElement {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-muted-foreground">
          Fetching 30d daily returns for all crypto assets…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-rose-300">
          Error: {error}
        </CardContent>
      </Card>
    );
  }
  if (!matrix || matrix.assets.length < 2) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-muted-foreground">
          Insufficient data — need ≥2 assets with ≥20 daily returns.
        </CardContent>
      </Card>
    );
  }

  const { assets, matrix: grid } = matrix;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Pearson Correlation Matrix (30d returns)
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="border-separate border-spacing-1 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-2 py-1 text-right text-[10px] uppercase tracking-wider text-muted-foreground">
                  ·
                </th>
                {assets.map((a) => (
                  <th
                    key={a}
                    className="px-2 py-1 text-[10px] font-medium text-muted-foreground"
                  >
                    {a.replace(/USDT$/, '')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((rowSym, i) => (
                <tr key={rowSym}>
                  <td className="sticky left-0 z-10 bg-card px-2 py-1 text-[10px] font-medium text-muted-foreground">
                    {rowSym.replace(/USDT$/, '')}
                  </td>
                  {assets.map((colSym, j) => {
                    const v = grid[i]?.[j] ?? 0;
                    const c = corrColor(v);
                    const isDiag = i === j;
                    return (
                      <td
                        key={`${rowSym}-${colSym}`}
                        className="rounded px-2 py-1.5 text-center font-mono text-[11px]"
                        style={{
                          backgroundColor: c.bg,
                          color: c.fg,
                          opacity: isDiag ? 0.5 : 1,
                        }}
                        title={`${rowSym.replace(/USDT$/, '')} ↔ ${colSym.replace(/USDT$/, '')}: r=${v.toFixed(3)} (${corrLabel(v)})`}
                      >
                        {isDiag ? '1.00' : v.toFixed(2)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-300" />
            Strongest Correlations (|r| sorted)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left">Pair</th>
                  <th className="px-2 py-2 text-right">r</th>
                  <th className="px-2 py-2 text-left">Interpretation</th>
                  <th className="px-2 py-2 text-right">Heat</th>
                </tr>
              </thead>
              <tbody>
                {matrix.entries.slice(0, 15).map((e, i) => {
                  const c = corrColor(e.r);
                  return (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        {e.x.replace(/USDT$/, '')} / {e.y.replace(/USDT$/, '')}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-right font-mono',
                          e.r > 0 ? 'text-emerald-400' : e.r < 0 ? 'text-rose-400' : 'text-muted-foreground',
                        )}
                      >
                        {e.r.toFixed(3)}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{corrLabel(e.r)}</td>
                      <td className="px-2 py-1.5 text-right">
                        <div
                          className="ml-auto h-2 w-16 rounded-sm"
                          style={{ backgroundColor: c.bg }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cointegration tab — pair list + ADF stats
// ---------------------------------------------------------------------------

function CointegrationTab({
  isLoading,
  error,
  matrix,
}: {
  isLoading: boolean;
  error?: string;
  matrix?: CointegrationMatrix;
}): React.ReactElement {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-muted-foreground">
          Fetching 1d klines + running Engle-Granger ADF on every pair…
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-rose-300">
          Error: {error}
        </CardContent>
      </Card>
    );
  }
  if (!matrix || matrix.entries.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-xs text-muted-foreground">
          No cointegration data — need ≥2 symbols.
        </CardContent>
      </Card>
    );
  }

  const cointegrated = matrix.entries.filter((e) => e.isCointegrated);
  const tradeable = matrix.entries.filter((e) => e.tradeable);

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Pairs Tested
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">{matrix.entries.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Cointegrated (ADF p&lt;0.05)
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-300">{cointegrated.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tradeable (|z|≥1)
          </div>
          <div className="mt-1 text-xl font-bold text-amber-300">{tradeable.length}</div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-primary" />
            Engle-Granger Cointegration — Tradeable Spreads
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tradeable.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No tradeable spreads right now. Cointegration requires both statistical
              stationarity (ADF p&lt;0.05) and a z-score deviation ≥1 from the mean.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-2 py-2 text-left">Pair</th>
                    <th className="px-2 py-2 text-right">Hedge β</th>
                    <th className="px-2 py-2 text-right">ADF</th>
                    <th className="px-2 py-2 text-right">p-value</th>
                    <th className="px-2 py-2 text-right">Half-life</th>
                    <th className="px-2 py-2 text-right">z-Score</th>
                    <th className="px-2 py-2 text-left">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeable.map((e, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-2 py-1.5 font-medium text-foreground">
                        {e.y.replace(/USDT$/, '')} / {e.x.replace(/USDT$/, '')}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {e.hedgeRatio.toFixed(3)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-foreground">
                        {e.adfStat.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {e.pValue.toFixed(3)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                        {Number.isFinite(e.halfLife) ? `${e.halfLife.toFixed(0)}d` : '∞'}
                      </td>
                      <td
                        className={cn(
                          'px-2 py-1.5 text-right font-mono',
                          e.zScore > 0 ? 'text-rose-300' : 'text-emerald-300',
                        )}
                      >
                        {e.zScore.toFixed(2)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant={
                            e.signal === 'long-spread'
                              ? 'success'
                              : e.signal === 'short-spread'
                                ? 'rose'
                                : 'muted'
                          }
                          className="text-[10px]"
                        >
                          {e.signal}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Pairs (sorted by |z|)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2 text-left">Pair</th>
                  <th className="px-2 py-2 text-right">ADF</th>
                  <th className="px-2 py-2 text-right">p</th>
                  <th className="px-2 py-2 text-right">z</th>
                  <th className="px-2 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {matrix.entries.slice(0, 50).map((e, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-2 py-1.5 font-medium text-foreground">
                      {e.y.replace(/USDT$/, '')} / {e.x.replace(/USDT$/, '')}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                      {e.adfStat.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                      {e.pValue.toFixed(3)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-foreground">
                      {e.zScore.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        {e.isCointegrated ? <Badge variant="success" className="text-[9px]">coint</Badge> : null}
                        {e.tradeable ? <Badge variant="warning" className="text-[9px]">tradeable</Badge> : null}
                        {!e.isCointegrated && !e.tradeable ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
