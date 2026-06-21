'use client';

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BrainSnap {
  thinking: boolean;
  lastTickDurationMs: number;
  running: boolean;
}

/**
 * "Brain thinking" live activity indicator — a pulsing waveform that animates
 * while a scheduler tick is in progress, so operators see the brain actively
 * processing (not just static stats). Polls /api/brain every 1.5s to catch the
 * brief thinking window. Shows the last tick's duration when idle.
 */
export function ThinkingIndicator() {
  const brain = useQuery({
    queryKey: ['brain-thinking'],
    queryFn: async () => {
      const r = await fetch('/api/brain', { cache: 'no-store' });
      const j = await r.json();
      if (!j.success) throw new Error('fail');
      return j.data as BrainSnap;
    },
    refetchInterval: 1500, // fast poll to catch the thinking window
    retry: 1,
  });
  const thinking = brain.data?.thinking ?? false;
  const lastMs = brain.data?.lastTickDurationMs ?? 0;
  const running = brain.data?.running ?? false;

  if (!running) {
    return <span className="text-[10px] text-rose-400/80 font-medium">paused</span>;
  }

  return (
    <div className="flex items-center gap-2">
      {thinking ? (
        // Animated waveform — 5 bars with staggered scale animation.
        <div className="flex items-end gap-0.5 h-4" aria-label="Brain thinking">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.span
              key={i}
              className="w-0.5 rounded-full bg-emerald-400"
              animate={{ height: ['30%', '100%', '40%', '80%', '30%'] }}
              transition={{
                duration: 0.9,
                repeat: Infinity,
                delay: i * 0.1,
                ease: 'easeInOut',
              }}
              style={{ height: '30%' }}
            />
          ))}
        </div>
      ) : (
        // Idle — show a flat line + last tick duration.
        <div className="flex items-end gap-0.5 h-4 opacity-40" aria-label="Brain idle">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="w-0.5 rounded-full bg-emerald-400" style={{ height: '25%' }} />
          ))}
        </div>
      )}
      <span className={cn('text-[10px] tabular-nums', thinking ? 'text-emerald-400 font-medium' : 'text-muted-foreground/70')}>
        {thinking ? 'thinking…' : lastMs > 0 ? `${lastMs}ms` : 'idle'}
      </span>
    </div>
  );
}
