'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { BrainCircuit } from 'lucide-react';

interface BrainSnapshot {
  running?: boolean;
  llmInCooldown?: boolean;
  stats?: { tokensSaved?: number; tokensUsed?: number };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${Math.round(n)}`;
}

/**
 * Compact footer indicator. A small brain chip with a pulsing status dot:
 *   - emerald = brain ON
 *   - amber   = LLM cooldown
 *   - rose    = brain OFF
 *
 * Shows tokens saved + links to /brain.
 */
export function FooterBrainIndicator(): React.ReactElement {
  const { data } = useQuery<BrainSnapshot>({
    queryKey: ['brain-footer'],
    queryFn: async () => {
      const res = await fetch('/api/brain');
      if (!res.ok) throw new Error('brain fetch failed');
      const json: { success?: boolean; data?: BrainSnapshot } = await res.json();
      return json.data ?? ({} as BrainSnapshot);
    },
    refetchInterval: 10000,
    staleTime: 8000,
  });

  const running = !!data?.running;
  const inCooldown = !!data?.llmInCooldown;
  const tokensSaved = data?.stats?.tokensSaved ?? 0;

  const dotClass = !running
    ? 'bg-rose-500'
    : inCooldown
      ? 'bg-amber-400'
      : 'bg-emerald-400';
  const label = !running ? 'Brain OFF' : inCooldown ? 'cooldown' : 'Brain ON';
  const labelClass = !running
    ? 'text-rose-300'
    : inCooldown
      ? 'text-amber-300'
      : 'text-emerald-300';

  return (
    <Link
      href="/brain"
      className="inline-flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/40"
    >
      <span className="relative flex h-4 w-4 items-center justify-center">
        <BrainCircuit className={`h-3.5 w-3.5 ${labelClass}`} />
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotClass} opacity-70`}
          />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotClass}`} />
        </span>
      </span>
      <span className={`font-mono text-[11px] ${labelClass}`}>{label}</span>
      {tokensSaved > 0 ? (
        <span className="font-mono text-[11px] text-muted-foreground">
          · {fmt(tokensSaved)} saved
        </span>
      ) : null}
    </Link>
  );
}
