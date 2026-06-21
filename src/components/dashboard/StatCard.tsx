'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { motion } from 'framer-motion';

interface StatCardProps {
  title: string;
  value: string;
  change?: number;
  icon?: React.ReactNode;
  subtitle?: string;
  accent?: 'emerald' | 'rose' | 'amber' | 'teal' | 'orange';
}

const accentMap = {
  emerald: {
    halo: 'from-emerald-500/20 to-emerald-500/5',
    text: 'text-emerald-500',
    ring: 'group-hover:border-emerald-500/40',
    glow: 'group-hover:shadow-emerald-500/10',
  },
  rose: {
    halo: 'from-rose-500/20 to-rose-500/5',
    text: 'text-rose-500',
    ring: 'group-hover:border-rose-500/40',
    glow: 'group-hover:shadow-rose-500/10',
  },
  amber: {
    halo: 'from-amber-500/20 to-amber-500/5',
    text: 'text-amber-500',
    ring: 'group-hover:border-amber-500/40',
    glow: 'group-hover:shadow-amber-500/10',
  },
  teal: {
    halo: 'from-teal-500/20 to-teal-500/5',
    text: 'text-teal-500',
    ring: 'group-hover:border-teal-500/40',
    glow: 'group-hover:shadow-teal-500/10',
  },
  orange: {
    halo: 'from-orange-500/20 to-orange-500/5',
    text: 'text-orange-500',
    ring: 'group-hover:border-orange-500/40',
    glow: 'group-hover:shadow-orange-500/10',
  },
};

export function StatCard({ title, value, change, icon, subtitle, accent = 'emerald' }: StatCardProps) {
  const isUp = (change ?? 0) > 0;
  const isDown = (change ?? 0) < 0;
  const a = accentMap[accent];
  // Direction tint — subtle background based on the metric direction.
  const dirTint = isUp
    ? 'bg-emerald-500/[0.04]'
    : isDown
      ? 'bg-rose-500/[0.04]'
      : 'bg-transparent';
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full"
    >
      <Card
        className={cn(
          'group relative h-full overflow-hidden border-border/60 ring-1 ring-inset ring-border/30 transition-all duration-200 ease-out',
          'hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5 dark:hover:shadow-black/30',
          a.ring,
          a.glow,
        )}
      >
        <div aria-hidden className={cn('absolute inset-0 bg-gradient-to-br opacity-100', dirTint)} />
        <div
          aria-hidden
          className={cn(
            'absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br blur-2xl opacity-80 transition-opacity duration-300 group-hover:opacity-100',
            a.halo,
          )}
        />
        <CardHeader className="relative flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </CardTitle>
          {icon && (
            <div
              className={cn(
                'relative transition-transform duration-200 ease-out group-hover:scale-110',
                a.text,
              )}
            >
              {icon}
            </div>
          )}
        </CardHeader>
        <CardContent className="relative">
          <div className="text-2xl font-bold tracking-tight tabular-nums">{value}</div>
          <div className="flex items-center gap-1.5 mt-1">
            {change !== undefined && (
              <span
                className={cn(
                  'flex items-center gap-0.5 text-xs font-semibold transition-colors duration-200',
                  isUp && 'text-emerald-500',
                  isDown && 'text-rose-500',
                  !isUp && !isDown && 'text-muted-foreground',
                )}
              >
                {isUp ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : isDown ? (
                  <ArrowDownRight className="h-3 w-3" />
                ) : (
                  <Minus className="h-3 w-3" />
                )}
                {Math.abs(change).toFixed(2)}%
              </span>
            )}
            {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
