'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Bot,
  Bell,
  ShieldCheck,
  Database,
  ListChecks,
  Cloud,
  ChevronRight,
  Settings,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Settings hub — 6 cards linking to sub-pages
// ---------------------------------------------------------------------------

interface SubPage {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accent: 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'orange';
}

const SUB_PAGES: SubPage[] = [
  {
    href: '/settings/providers',
    title: 'LLM Providers',
    description: 'Manage free LLM providers (Pollinations, Gemini, Groq, NVIDIA, Mistral, OpenRouter). Add API keys, set base URLs, toggle active.',
    icon: <Bot className="h-5 w-5" />,
    accent: 'amber',
  },
  {
    href: '/settings/alerts',
    title: 'Alerts',
    description: 'Telegram bot token + chat ID, alert thresholds, price-alert checker. Test message delivery.',
    icon: <Bell className="h-5 w-5" />,
    accent: 'rose',
  },
  {
    href: '/settings/security',
    title: 'Security',
    description: 'App password (gate access to the dashboard). Change or clear the password.',
    icon: <ShieldCheck className="h-5 w-5" />,
    accent: 'emerald',
  },
  {
    href: '/settings/data-sources',
    title: 'Data Sources',
    description: 'Finnhub API key for the economic calendar. Enable/disable external data sources.',
    icon: <Database className="h-5 w-5" />,
    accent: 'sky',
  },
  {
    href: '/settings/watchlists',
    title: 'Watchlists',
    description: 'Manage named watchlists. Each list holds a set of symbols the brain monitors.',
    icon: <ListChecks className="h-5 w-5" />,
    accent: 'violet',
  },
  {
    href: '/settings/supabase',
    title: 'Supabase',
    description: 'Optional cloud sync. Configure URL + anon key to mirror signals + alerts to a remote Supabase instance.',
    icon: <Cloud className="h-5 w-5" />,
    accent: 'orange',
  },
];

const ACCENT_MAP: Record<SubPage['accent'], { border: string; text: string; bg: string }> = {
  amber: { border: 'border-amber-500/30', text: 'text-amber-300', bg: 'bg-amber-500/15' },
  rose: { border: 'border-rose-500/30', text: 'text-rose-300', bg: 'bg-rose-500/15' },
  emerald: { border: 'border-emerald-500/30', text: 'text-emerald-300', bg: 'bg-emerald-500/15' },
  sky: { border: 'border-sky-500/30', text: 'text-sky-300', bg: 'bg-sky-500/15' },
  violet: { border: 'border-violet-500/30', text: 'text-violet-300', bg: 'bg-violet-500/15' },
  orange: { border: 'border-orange-500/30', text: 'text-orange-300', bg: 'bg-orange-500/15' },
};

export function SettingsHubClient(): React.ReactElement {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
          <Settings className="h-5 w-5 text-primary" />
          Settings
        </h1>
        <p className="text-xs text-muted-foreground">
          Configuration hub for LLM providers, alerts, security, data sources, watchlists, and
          Supabase sync.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SUB_PAGES.map((p) => {
          const a = ACCENT_MAP[p.accent];
          return (
            <Link key={p.href} href={p.href} className="block">
              <Card
                className={cn(
                  'h-full ring-1 ring-inset ring-border/30 transition-colors hover:border-primary/40',
                  a.border,
                )}
              >
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg',
                        a.bg,
                        a.text,
                      )}
                    >
                      {p.icon}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-foreground">{p.title}</span>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {p.description}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="flex items-start gap-2 p-4 text-[11px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <div>
            <p className="font-semibold text-emerald-200">All settings stored locally</p>
            <p>
              Settings are persisted in the OMNISCIENT SQLite database via the Setting KV table.
              API keys are stored verbatim — do not commit the <code className="font-mono">.db</code> file.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageHeader — reusable header for sub-pages
// ---------------------------------------------------------------------------

export function SettingsPageHeader({
  title,
  description,
  backHref = '/settings',
}: {
  title: string;
  description: string;
  backHref?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <Link
        href={backHref}
        className="text-[11px] text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SaveButton — reusable save button with state
// ---------------------------------------------------------------------------

export function useSaveState(): {
  saving: boolean;
  saved: boolean;
  error: string | null;
  start: () => void;
  succeed: () => void;
  fail: (msg: string) => void;
  reset: () => void;
} {
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return {
    saving,
    saved,
    error,
    start: () => {
      setSaving(true);
      setSaved(false);
      setError(null);
    },
    succeed: () => {
      setSaving(false);
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 2500);
    },
    fail: (msg: string) => {
      setSaving(false);
      setError(msg);
    },
    reset: () => {
      setSaving(false);
      setSaved(false);
      setError(null);
    },
  };
}
