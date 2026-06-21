'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';

interface BrainApiSnapshot {
  thinking?: boolean;
  tickStartTs?: number;
  lastTickDurationMs?: number;
  running?: boolean;
}

/**
 * Animated 5-bar waveform shown next to the brain header (and reused on the
 * dashboard banner). When the brain is "thinking" (tickStartTs > 0) the bars
 * bounce in an emerald waveform; when idle, they fall flat and dim.
 *
 * Polls /api/brain at 1.5s — tighter than the dashboard so the waveform feels
 * responsive to ticks.
 */
export function ThinkingIndicator(): React.ReactElement {
  const { data } = useQuery<BrainApiSnapshot>({
    queryKey: ['brain-thinking'],
    queryFn: async () => {
      const res = await fetch('/api/brain');
      if (!res.ok) throw new Error('brain fetch failed');
      const json: { success?: boolean; data?: BrainApiSnapshot } = await res.json();
      return json.data ?? ({} as BrainApiSnapshot);
    },
    refetchInterval: 1500,
    staleTime: 1000,
  });

  const thinking = !!data?.thinking;
  const paused = data && data.running === false;
  const lastMs = data?.lastTickDurationMs ?? 0;

  const label = paused
    ? 'paused'
    : thinking
      ? 'thinking…'
      : lastMs > 0
        ? `${lastMs}ms`
        : 'idle';

  const bars = [0, 1, 2, 3, 4];
  return (
    <div className="flex items-center gap-2" aria-label={`Brain status: ${label}`}>
      <div className="flex items-end gap-[3px]" style={{ height: 18 }}>
        {bars.map((i) => (
          <motion.span
            key={i}
            className="block w-[3px] rounded-full"
            animate={
              thinking
                ? {
                    height: [4, 16, 8, 14, 6],
                    opacity: [0.7, 1, 0.8, 1, 0.7],
                  }
                : { height: 3, opacity: 0.3 }
            }
            transition={
              thinking
                ? {
                    duration: 0.9,
                    repeat: Infinity,
                    repeatType: 'mirror',
                    delay: i * 0.08,
                    ease: 'easeInOut',
                  }
                : { duration: 0.3 }
            }
            style={{
              backgroundColor: 'oklch(0.78 0.18 160)',
              filter: thinking ? 'drop-shadow(0 0 4px oklch(0.78 0.18 160 / 0.7))' : 'none',
            }}
          />
        ))}
      </div>
      <span
        className={`font-mono text-[10px] tracking-tight ${
          thinking ? 'text-emerald-300' : 'text-muted-foreground'
        }`}
      >
        {label}
      </span>
    </div>
  );
}
