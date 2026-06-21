'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Sparkline } from './Sparkline';

interface BrainSnapshot {
  running?: boolean;
  mode?: string;
  llmInCooldown?: boolean;
  stats?: {
    tokensUsed?: number;
    tokensSaved?: number;
    llmCallsTotal?: number;
  };
  statsSamples?: Array<{ ts: number; tokensUsed: number; tokensSaved: number }>;
  watch?: Array<{ symbol: string }>;
  tickStartTs?: number;
  lastTickDurationMs?: number;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

/**
 * Dashboard banner. Emerald palette to match the dashboard's accent. Renders:
 *   - Brain icon with ping dot (emerald when running, amber when in cooldown)
 *   - AUTONOMOUS / PAUSED badge
 *   - COOLDOWN badge when the LLM circuit-breaker is tripped
 *   - assets watched + last-tick ago
 *   - 3 mini-stats: tokens used (amber), saved % (emerald), LLM calls (orange)
 *   - savings sparkline (130×34)
 *
 * Whole card links to /brain.
 */
function ago(ts: number | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.max(0, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export function BrainStatusCard(): React.ReactElement {
  const { data } = useQuery<BrainSnapshot>({
    queryKey: ['brain-status-card'],
    queryFn: async () => {
      const res = await fetch('/api/brain');
      if (!res.ok) throw new Error('brain fetch failed');
      const json: { success?: boolean; data?: BrainSnapshot } = await res.json();
      return json.data ?? ({} as BrainSnapshot);
    },
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const running = !!data?.running;
  const inCooldown = !!data?.llmInCooldown;
  const stats = data?.stats ?? {};
  const samples = data?.statsSamples ?? [];
  const watchCount = data?.watch?.length ?? 0;

  const tokensUsed = stats.tokensUsed ?? 0;
  const tokensSaved = stats.tokensSaved ?? 0;
  const llmCalls = stats.llmCallsTotal ?? 0;
  const gross = tokensUsed + tokensSaved;
  const savedPct = gross > 0 ? (tokensSaved / gross) * 100 : 0;

  const dotColor = !running ? 'bg-rose-500' : inCooldown ? 'bg-amber-400' : 'bg-emerald-400';
  const statusLabel = !running ? 'PAUSED' : inCooldown ? 'COOLDOWN' : 'AUTONOMOUS';
  const statusClass = !running
    ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    : inCooldown
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

  return (
    <Link href="/brain" className="block">
      <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-950/30 via-card to-card p-4 transition-colors hover:border-emerald-500/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15">
              <BrainCircuit className="h-4.5 w-4.5 text-emerald-300" />
              <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-60`}
                />
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${dotColor}`} />
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Lazy Brain
              </span>
              <span
                className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${statusClass}`}
              >
                {statusLabel}
              </span>
            </div>
          </div>
          <Sparkline samples={samples} width={130} height={34} />
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div>
            <div className="text-muted-foreground">Tokens</div>
            <div className="font-mono text-amber-300">{fmt(tokensUsed)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Saved</div>
            <div className="font-mono text-emerald-300">{savedPct.toFixed(0)}%</div>
          </div>
          <div>
            <div className="text-muted-foreground">LLM calls</div>
            <div className="font-mono text-orange-300">{fmt(llmCalls)}</div>
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{watchCount} assets watched</span>
          <span>
            last tick{' '}
            {data?.lastTickDurationMs
              ? `${data.lastTickDurationMs}ms`
              : 'never'}
          </span>
        </div>
      </Card>
    </Link>
  );
}
