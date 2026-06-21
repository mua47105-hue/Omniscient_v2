'use client';

import * as React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface StatCardProps {
  title: string;
  value: string;
  changePct?: number;
  icon?: React.ReactNode;
  accent?: 'amber' | 'teal' | 'emerald' | 'rose' | 'orange' | 'sky' | 'violet' | 'muted';
  sub?: string;
}

const ACCENT_MAP: Record<NonNullable<StatCardProps['accent']>, { border: string; text: string }> = {
  amber: { border: 'border-amber-500/30', text: 'text-amber-300' },
  teal: { border: 'border-teal-500/30', text: 'text-teal-300' },
  emerald: { border: 'border-emerald-500/30', text: 'text-emerald-300' },
  rose: { border: 'border-rose-500/30', text: 'text-rose-300' },
  orange: { border: 'border-orange-500/30', text: 'text-orange-300' },
  sky: { border: 'border-sky-500/30', text: 'text-sky-300' },
  violet: { border: 'border-violet-500/30', text: 'text-violet-300' },
  muted: { border: 'border-border', text: 'text-muted-foreground' },
};

export function StatCard({
  title,
  value,
  changePct,
  icon,
  accent = 'muted',
  sub,
}: StatCardProps): React.ReactElement {
  const a = ACCENT_MAP[accent];
  const positive = (changePct ?? 0) >= 0;
  return (
    <Card className={cn('p-4', a.border)}>
      <div className="flex items-start justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</span>
        {icon ? <span className={a.text}>{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {changePct != null ? (
          <span
            className={cn(
              'font-mono',
              positive ? 'text-emerald-400' : 'text-rose-400',
            )}
          >
            {positive ? '+' : ''}
            {changePct.toFixed(2)}%
          </span>
        ) : null}
        {sub ? <span className="text-muted-foreground">{sub}</span> : null}
      </div>
    </Card>
  );
}
