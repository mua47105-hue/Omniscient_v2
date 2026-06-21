'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Activity, TrendingUp, TrendingDown, Layers } from 'lucide-react';

// ---------------------------------------------------------------------------
// API shapes (parallel-built endpoints — assume these shapes)
// ---------------------------------------------------------------------------

interface DerivativesV2Response {
  success?: boolean;
  data?: {
    regime?: string;
    basis?: number;
    riskReversal25Delta?: { riskReversal?: number; callIv?: number; putIv?: number };
    dvol?: number;
    vrp?: number;
    realizedVol?: number;
    spot?: number;
    rationale?: string;
    currency?: string;
  };
  error?: string;
}

interface FearGreedEdgeResponse {
  success?: boolean;
  data?: {
    currentValue?: number;
    regime?: string;
    streakDays?: number;
    streakZone?: string;
    edge?: string;
    conviction?: number;
    rationale?: string;
    historyLen?: number;
  };
  error?: string;
}

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function regimeBadgeVariant(regime?: string): 'default' | 'success' | 'warning' | 'destructive' | 'violet' {
  if (!regime) return 'default';
  const r = regime.toLowerCase();
  if (r.includes('euphor') || r.includes('greed')) return 'destructive';
  if (r.includes('capit')) return 'success';
  if (r.includes('neutral')) return 'default';
  if (r.includes('momentum') || r.includes('long')) return 'success';
  return 'violet';
}

/**
 * EdgeSourcesCard. Two columns:
 *   - E4 Derivatives Intelligence (regime + basis/RR/DVOL/VRP + rationale)
 *   - E8 Asymmetric F&G Edge (value + regime + streak + edge badge + conviction + rationale)
 *
 * Both endpoints are best-effort — graceful when unavailable.
 */
export function EdgeSourcesCard(): React.ReactElement {
  const derivativesQ = useQuery<DerivativesV2Response>({
    queryKey: ['edge-derivatives-v2'],
    queryFn: async () => {
      const res = await fetch('/api/analysis/derivatives-v2');
      if (!res.ok) throw new Error('derivatives-v2 fetch failed');
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const fgEdgeQ = useQuery<FearGreedEdgeResponse>({
    queryKey: ['edge-fear-greed'],
    queryFn: async () => {
      const res = await fetch('/api/analysis/fear-greed-edge');
      if (!res.ok) throw new Error('fear-greed-edge fetch failed');
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
  });

  const d = derivativesQ.data?.data;
  const f = fgEdgeQ.data?.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-violet-300" />
          Edge Sources
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {/* E4 — Derivatives Intelligence */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                E4
              </span>
              <span className="text-xs font-medium">Derivatives Intelligence</span>
            </div>
            {derivativesQ.isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <Badge variant={regimeBadgeVariant(d?.regime)}>{d?.regime ?? '—'}</Badge>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 text-[10px]">
            <Metric label="Basis" value={fmt(d?.basis, 2)} suffix="%" />
            <Metric label="RR (25Δ)" value={fmt(d?.riskReversal25Delta?.riskReversal, 1)} />
            <Metric label="DVOL" value={fmt(d?.dvol, 0)} suffix="%" />
            <Metric label="VRP" value={fmt(d?.vrp, 1)} suffix="%" />
          </div>
          <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">
            {d?.rationale ?? 'Awaiting Deribit + Binance Coin-M data…'}
          </p>
        </div>

        {/* E8 — Asymmetric F&G Edge */}
        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                E8
              </span>
              <span className="text-xs font-medium">Asymmetric F&amp;G Edge</span>
            </div>
            {fgEdgeQ.isLoading ? (
              <Skeleton className="h-4 w-16" />
            ) : (
              <Badge variant={regimeBadgeVariant(f?.edge ?? f?.regime)}>{f?.edge ?? 'neutral'}</Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <Metric label="F&amp;G" value={fmt(f?.currentValue, 0)} />
            <Metric label="Streak" value={fmt(f?.streakDays, 0)} suffix="d" />
            <Metric label="Conv." value={fmt(f?.conviction, 0)} suffix="%" />
          </div>
          <p className="mt-2 line-clamp-3 text-[11px] text-muted-foreground">
            {f?.rationale ?? 'Awaiting Fear & Greed index…'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  suffix,
}: {
  label: string;
  value: string;
  suffix?: string;
}): React.ReactElement {
  return (
    <div className="rounded bg-background/40 px-1.5 py-1">
      <div className="text-muted-foreground">{label}</div>
      <div className="flex items-baseline gap-0.5 font-mono text-xs text-foreground">
        {value}
        {suffix ? <span className="text-[9px] text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}
