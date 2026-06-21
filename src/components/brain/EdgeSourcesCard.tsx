'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, AlertTriangle, Activity, Gauge } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline } from '@/components/brain/Sparkline';

interface DerivativesV2 {
  basisTermStructure: number | null;
  riskReversal25Delta: number | null;
  vrp: number | null;
  dvol: number | null;
  regime: 'CAPITULATION' | 'NEUTRAL' | 'EUPHORIA';
  rationale: string;
}
interface FearGreedEdge {
  currentValue: number;
  streakDays: number;
  regime: string;
  edge: 'MOMENTUM_LONG' | 'MEAN_REVERT_LONG' | 'MEAN_REVERT_SHORT' | 'NEUTRAL';
  conviction: number;
  rationale: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'failed');
  return j.data as T;
}

function regimeColor(r: string): string {
  if (r === 'CAPITULATION') return 'text-rose-400';
  if (r === 'EUPHORIA') return 'text-amber-400';
  return 'text-muted-foreground';
}
function edgeColor(e: string): string {
  if (e === 'MOMENTUM_LONG' || e === 'MEAN_REVERT_LONG') return 'text-emerald-400';
  if (e === 'MEAN_REVERT_SHORT') return 'text-rose-400';
  return 'text-muted-foreground';
}

/**
 * "Edge Sources" card — surfaces the research-backed signal layers from the
 * Field Guide to Real Edge (Vol. 2). Shows the derivatives-v2 regime (E4:
 * basis + 25Δ skew + VRP), the asymmetric F&G edge (E8), and the Hurst regime
 * (E10). All free data, zero tokens — these are deterministic confirmation
 * layers that complement the brain's LLM-gated analysis.
 */
export function EdgeSourcesCard() {
  const derivQ = useQuery({ queryKey: ['deriv-v2'], queryFn: () => fetchJson<DerivativesV2>('/api/analysis/derivatives-v2'), refetchInterval: 8 * 60 * 60 * 1000, retry: 1 });
  const fgEdgeQ = useQuery({ queryKey: ['fg-edge'], queryFn: () => fetchJson<FearGreedEdge>('/api/analysis/fear-greed-edge'), refetchInterval: 30 * 60 * 1000, retry: 1 });

  const deriv = derivQ.data;
  const fgEdge = fgEdgeQ.data;

  return (
    <Card className="border-border/60 ring-1 ring-inset ring-border/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-fuchsia-400" /> Edge Sources
          <span className="text-[10px] font-normal text-muted-foreground ml-1">research-backed · Vol. 2</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {/* E4 Derivatives-v2: basis + skew + VRP + regime */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" /> Derivatives Intelligence (E4)
          </div>
          {derivQ.isLoading ? (
            <div className="h-[100px] space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)}</div>
          ) : !deriv ? (
            <div className="text-xs text-muted-foreground/60 py-4 text-center h-[100px] flex items-center justify-center">Unavailable</div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={cn('text-[10px]', regimeColor(deriv.regime))}>{deriv.regime}</Badge>
                {deriv.basisTermStructure !== null && (
                  <span className={cn('text-xs font-mono tabular-nums', deriv.basisTermStructure < -5 ? 'text-emerald-400' : deriv.basisTermStructure > 15 ? 'text-rose-400' : 'text-muted-foreground')}>
                    basis {deriv.basisTermStructure.toFixed(1)}%
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="rounded bg-muted/20 px-2 py-1">
                  <div className="text-muted-foreground">25Δ RR</div>
                  <div className={cn('font-mono font-semibold', deriv.riskReversal25Delta !== null && deriv.riskReversal25Delta < -6 ? 'text-emerald-400' : 'text-foreground')}>
                    {deriv.riskReversal25Delta?.toFixed(1) ?? '—'}
                  </div>
                </div>
                <div className="rounded bg-muted/20 px-2 py-1">
                  <div className="text-muted-foreground">DVOL</div>
                  <div className="font-mono font-semibold">{deriv.dvol?.toFixed(0) ?? '—'}</div>
                </div>
                <div className="rounded bg-muted/20 px-2 py-1">
                  <div className="text-muted-foreground">VRP</div>
                  <div className="font-mono font-semibold">{deriv.vrp?.toFixed(1) ?? '—'}</div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{deriv.rationale}</p>
            </div>
          )}
        </div>

        {/* E8 Asymmetric F&G: streak + edge */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Asymmetric F&amp;G Edge (E8)
          </div>
          {fgEdgeQ.isLoading ? (
            <div className="h-[100px] space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-6 rounded bg-muted/40 animate-pulse" />)}</div>
          ) : !fgEdge ? (
            <div className="text-xs text-muted-foreground/60 py-4 text-center h-[100px] flex items-center justify-center">Unavailable</div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={cn('text-lg font-bold', fgEdge.currentValue < 25 ? 'text-rose-400' : fgEdge.currentValue < 45 ? 'text-orange-400' : fgEdge.currentValue < 55 ? 'text-amber-400' : fgEdge.currentValue < 75 ? 'text-lime-400' : 'text-emerald-400')}>
                  {fgEdge.currentValue}
                </span>
                <Badge variant="outline" className={cn('text-[10px]', edgeColor(fgEdge.edge))}>
                  {fgEdge.edge !== 'NEUTRAL' && <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />}
                  {fgEdge.edge}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{fgEdge.regime}</span>
                <span className="opacity-40">·</span>
                <span>{fgEdge.streakDays}d streak</span>
                {fgEdge.conviction > 0 && <Badge variant="outline" className="text-[9px] py-0 ml-auto">conv {fgEdge.conviction}</Badge>}
              </div>
              <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{fgEdge.rationale}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
