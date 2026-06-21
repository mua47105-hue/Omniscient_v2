'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Bell, Command, Search } from 'lucide-react';
import { MobileNav } from './MobileNav';

/**
 * Top app bar. Hosts the mobile menu trigger, a command-palette button (⌘K),
 * the markets open/closed status, and a notifications bell.
 */
function useMarketsOpen(): { open: boolean; label: string } {
  // Crypto is 24/7 — the banner is always "open". Forex/stock session label is
  // derived from the current UTC time without an effect (pure of render).
  const now = new Date();
  const utcDay = now.getUTCDay();
  const utcH = now.getUTCHours();
  const forexOpen = !(
    utcDay === 6 ||
    (utcDay === 0 && utcH < 22) ||
    (utcDay === 5 && utcH >= 22)
  );
  return { open: true, label: forexOpen ? 'Markets Open' : 'Crypto · 24/7' };
}

export function Header(): React.ReactElement {
  const markets = useMarketsOpen();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:px-6">
      <MobileNav />
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="hidden md:inline-flex h-8 gap-2 px-3 text-xs text-muted-foreground"
        aria-label="Command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="ml-2 inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1 font-mono text-[10px]">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </Button>
      <div className="hidden md:flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px]">
        <span
          className={`h-1.5 w-1.5 rounded-full ${markets.open ? 'bg-emerald-400' : 'bg-amber-400'}`}
        />
        <span className="text-muted-foreground">{markets.label}</span>
      </div>
      <Button variant="ghost" size="icon" className="relative">
        <Bell className="h-4 w-4" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
        <span className="sr-only">Notifications</span>
      </Button>
    </header>
  );
}
