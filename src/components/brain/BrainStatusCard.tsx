'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, Coins, TrendingDown, Target, Clock, ArrowRight, Pause, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Sparkline } from '@/components/brain/Sparkline';

interface BrainSnapshot {
  running: boolean;
  mode: 'auto' | 'manual';
  llm: { inCooldown: boolean; consecutiveFailures: number };
  stats: { ticksTotal: number; llmCallsTotal: number; tokensUsed: number; tokensSaved: number; cacheHits: number; lastTickAt: number | null };
  watch: { symbol: string; lastAction: string; lastNoteworthiness: number }[];
  samples?: { ts: number; tokensUsed: number; tokensSaved: number }[];
}

async function fetchBrain(): Promise<BrainSnapshot> {
  const r = await fetch('/api/brain', { cache: 'no-store' });
  const j = await r.json();
  if (!j.success) throw new Error('fetch failed');
  return j.data;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

/**
 * Compact brain-status banner for the overview dashboard. Surfaces the
 * autonomous system's vital signs (running, tokens saved, last tick, active
 * assets) to casual viewers who land on `/` and might never visit /brain.
 * Links to the full control panel for detail.
 */
export function BrainStatusCard() {
  const brain = useQuery({ queryKey: ['brain-overview'], queryFn: fetchBrain, refetchInterval: 5000, retry: 1 });
  const snap = brain.data;

  const running = snap?.running ?? false;
  const savedPct = snap && snap.stats.tokensUsed + snap.stats.tokensSaved > 0
    ? (snap.stats.tokensSaved / (snap.stats.tokensUsed + snap.stats.tokensSaved)) * 100 : 0;
  // How many assets is the brain actively watching this tick.
  const activeAssets = snap?.watch.filter((w) => w.lastAction === 'analyze' || w.lastNoteworthiness >= 35).length ?? 0;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Link href="/brain" aria-label="View the Lazy Brain control panel" className="block focus-visible:outline-none">
        <Card className="group relative overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 hover:border-emerald-500/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-emerald-500/10 transition-all duration-200 ease-out cursor-pointer">
          {/* Ambient gradient — emerald-forward to match the dashboard's palette
              (BTC amber, ETH teal, breadth emerald/rose, volume orange). The
              brain banner now reads as part of the same family, not a separate
              sky/purple accent. */}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-teal-500/[0.04] to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-300" />
          <div aria-hidden className="absolute -left-8 top-1/2 -translate-y-1/2 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl group-hover:bg-emerald-500/15 transition-colors duration-500" />

          <CardContent className="relative p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: status + label */}
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/25 to-teal-500/10 ring-1 ring-inset ring-emerald-500/20">
                <Brain className={cn('h-5 w-5 transition-colors', running ? 'text-emerald-400' : 'text-muted-foreground')} />
                {running && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold">The Lazy Brain</span>
                  <Badge variant="outline" className={cn('text-[9px] gap-1 py-0', running ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/15 text-rose-400 border-rose-500/30')}>
                    {running ? <><Zap className="h-2.5 w-2.5" />AUTONOMOUS</> : <><Pause className="h-2.5 w-2.5" />PAUSED</>}
                  </Badge>
                  {snap?.llm?.inCooldown && (
                    <Badge variant="outline" className="text-[9px] gap-1 py-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                      <Clock className="h-2.5 w-2.5" />COOLDOWN
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                  <span>{activeAssets} assets watched</span>
                  <span className="opacity-40">·</span>
                  <span>tick {ago(snap?.stats.lastTickAt ?? null)}</span>
                </div>
              </div>
            </div>

            {/* Right: token-economy mini-stats + savings sparkline.
                Accents match the dashboard palette (amber tokens, emerald saved,
                orange calls) so the banner reads as part of the same family. */}
            <div className="flex items-center gap-4 sm:gap-5">
              <MiniStat icon={<Coins className="h-3.5 w-3.5" />} label="Tokens" value={fmt(snap?.stats.tokensUsed ?? 0)} accent="text-amber-400" />
              <div className="h-8 w-px bg-border/40 hidden sm:block" />
              <MiniStat icon={<TrendingDown className="h-3.5 w-3.5" />} label="Saved" value={`${savedPct.toFixed(0)}%`} accent="text-emerald-400" />
              <div className="h-8 w-px bg-border/40 hidden sm:block" />
              <MiniStat icon={<Target className="h-3.5 w-3.5" />} label="LLM calls" value={`${snap?.stats.llmCallsTotal ?? 0}`} accent="text-orange-400" />
              {/* Savings sparkline — emerald area = tokens saved, amber line = used. */}
              <div className="hidden lg:flex flex-col items-end gap-0.5 text-emerald-400/80">
                <span className="text-[8px] uppercase tracking-wider opacity-60">{fmt(snap?.stats.tokensSaved ?? 0)} saved</span>
                <Sparkline samples={snap?.samples ?? []} width={130} height={34} />
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-400 hidden sm:block" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </motion.div>
  );
}

function MiniStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col items-center text-center min-w-[48px]">
      <span className={cn('flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground', accent)}>
        {icon}
      </span>
      <span className={cn('text-sm font-bold tabular-nums leading-tight', accent)}>{value}</span>
      <span className="text-[9px] text-muted-foreground/70">{label}</span>
    </div>
  );
}
