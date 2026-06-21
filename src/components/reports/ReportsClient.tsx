'use client';

import { motion } from 'framer-motion';
import {
  BarChart3,
  Sun,
  CalendarRange,
  CalendarClock,
  ArrowRight,
  Cpu,
  Trophy,
  TrendingUp,
  FileText,
  Archive,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface ReportType {
  key: 'daily' | 'weekly' | 'monthly';
  title: string;
  cadence: string;
  icon: typeof Sun;
  description: string;
  sections: string[];
  highlight?: string;
}

const REPORT_TYPES: ReportType[] = [
  {
    key: 'daily',
    title: 'Daily Digest',
    cadence: 'Every morning · 08:00 UTC',
    icon: Sun,
    description:
      'A concise morning brief covering overnight market action, the day’s top 3–5 conviction signals, and any macro catalysts on the calendar.',
    sections: [
      'Overnight market summary',
      'Top conviction signals (last 24h)',
      'Pending economic events',
      'Watchlist movers',
      'Telegram-ready summary',
    ],
  },
  {
    key: 'weekly',
    title: 'Weekly Summary',
    cadence: 'Every Monday · 09:00 UTC',
    icon: CalendarRange,
    description:
      'A broader retrospective of last week’s signal performance, sector rotation, and forward outlook for the week ahead.',
    sections: [
      'Week-over-week signal win-rate',
      'Best & worst calls per model',
      'Sector / asset-class rotation',
      'Macro regime change detection',
      'Forward-week watchlist',
    ],
  },
  {
    key: 'monthly',
    title: 'Monthly Retrospective',
    cadence: '1st of month · 10:00 UTC',
    icon: CalendarClock,
    description:
      'The flagship report. Auto-reweights LLM models by their measured accuracy; full retrospective + next-month forecast.',
    sections: [
      'Model accuracy leaderboard & reweighting',
      'Full month signal retrospective',
      'Cross-asset correlation shifts',
      'Macro regime classification',
      'Next-month forward forecast',
    ],
    highlight: 'Auto-rewrites model weights based on measured accuracy',
  },
];

export function ReportsClient() {
  return (
    <div className="space-y-8">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-4"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
          <Sparkles className="h-3 w-3" />
          Phase 4 · Self-improving Layer
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-4xl flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-emerald-500" />
          Intelligence Reports
        </h1>
        <p className="text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed">
          Daily digests, weekly summaries, and monthly retrospectives with forward forecasts.
          Every report compounds on the last — the system grades its own accuracy and rewires
          itself to do better next time.
        </p>
      </motion.div>

      {/* Three large cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {REPORT_TYPES.map((r, i) => {
          const Icon = r.icon;
          const isFlagship = r.key === 'monthly';
          return (
            <motion.div
              key={r.key}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 + i * 0.08, duration: 0.35 }}
            >
              <Card
                className={cn(
                  'h-full overflow-hidden border-border/60 hover:border-emerald-500/30 transition-all relative',
                  isFlagship && 'border-emerald-500/40 bg-emerald-500/[0.03]',
                )}
              >
                {isFlagship && (
                  <div className="absolute top-0 right-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500 text-white rounded-bl-lg">
                    Flagship
                  </div>
                )}
                <CardHeader>
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500">
                    <Icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-base mt-3">{r.title}</CardTitle>
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                    {r.cadence}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {r.description}
                  </p>

                  {r.highlight && (
                    <div className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
                      <p className="text-[11px] font-medium text-emerald-500 flex items-start gap-1.5">
                        <Trophy className="h-3 w-3 shrink-0 mt-0.5" />
                        {r.highlight}
                      </p>
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      What&apos;s inside
                    </p>
                    {r.sections.map((s) => (
                      <div
                        key={s}
                        className="flex items-start gap-2 text-xs text-muted-foreground"
                      >
                        <ArrowRight className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                        {s}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-500"
                    >
                      Phase 4
                    </Badge>
                    <span className="text-[10px] text-muted-foreground/70">Auto-generated</span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Report Archive */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Archive className="h-4 w-4 text-emerald-500" />
            Report Archive
          </h2>
          <Badge variant="outline" className="px-2 py-1 text-[11px]">
            0 reports
          </Badge>
        </div>

        <Card className="border-dashed border-border/60">
          <CardContent className="p-10 flex flex-col items-center justify-center text-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
              <FileText className="h-7 w-7" />
            </div>
            <div className="space-y-1.5 max-w-md">
              <p className="font-semibold">No reports generated yet</p>
              <p className="text-sm text-muted-foreground">
                The system learns and generates its first monthly report after 30 days of signal
                tracking. Daily digests begin on day one of live signal generation.
              </p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/signals">
                  <TrendingUp className="h-3.5 w-3.5" />
                  View signals
                </Link>
              </Button>
              <Button
                asChild
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Link href="/crypto">
                  <Cpu className="h-3.5 w-3.5" />
                  Start tracking
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom note */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className={cn(
          'rounded-xl border border-border/60 bg-card/40 p-5',
          'flex items-start gap-3',
        )}
      >
        <Cpu className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">How model reweighting works</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Each closed signal is graded by realised P&L. Every month, the system tallies
            per-model accuracy across all layers (technical, sentiment, macro…) and shifts
            consensus weights toward the models that were right. The monthly report publishes
            both the new weights and the rationale — full transparency, no black boxes.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
