'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrainSnap {
  running: boolean;
  llm: { inCooldown: boolean };
  stats: { tokensSaved: number; tokensUsed: number };
}

/**
 * Compact brain-health indicator for the footer — surfaces the autonomous
 * system's status on EVERY page (not just the dashboard). Shows a pulsing dot
 * + "Brain: ON" / tokens-saved. Links to /brain for detail.
 */
export function FooterBrainIndicator() {
  const brain = useQuery({
    queryKey: ['brain-footer'],
    queryFn: async () => {
      const r = await fetch('/api/brain', { cache: 'no-store' });
      const j = await r.json();
      if (!j.success) throw new Error('fail');
      return j.data as BrainSnap;
    },
    refetchInterval: 10000,
    retry: 1,
  });
  const snap = brain.data;
  const running = snap?.running ?? false;
  const saved = snap?.stats.tokensSaved ?? 0;

  return (
    <Link href="/brain" className="flex items-center gap-1.5 hover:text-foreground transition-colors group" aria-label="Brain status">
      <Brain className={cn('h-3.5 w-3.5 transition-colors', running ? 'text-emerald-500 group-hover:text-emerald-400' : 'text-muted-foreground')} />
      <span className="relative flex h-1.5 w-1.5">
        {running && !snap?.llm?.inCooldown && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', running ? (snap?.llm?.inCooldown ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-rose-500')} />
      </span>
      <span className="hidden md:inline">
        Brain {running ? (snap?.llm?.inCooldown ? 'cooldown' : 'ON') : 'OFF'}
        {saved > 0 && <span className="text-emerald-500/80 ml-1.5 tabular-nums">{saved.toLocaleString()} tok saved</span>}
      </span>
    </Link>
  );
}
