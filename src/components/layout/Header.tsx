'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommandPaletteTrigger } from '@/components/dashboard/CommandPalette';
import { cn } from '@/lib/utils';

interface MarketStatus {
  open: boolean;
  label: string;
  detail: string;
}

function computeMarketStatus(): MarketStatus {
  // Use IST (Asia/Calcutta) for the Indian equity market clock.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Calcutta',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  const hh = parseInt(get('hour'), 10);
  const mm = parseInt(get('minute'), 10);
  const minutes = hh * 60 + mm;
  const isWeekday = wd !== 'Sat' && wd !== 'Sun';
  // NSE / BSE: 09:15 - 15:30 IST, Mon-Fri
  const nseOpen = isWeekday && minutes >= 555 && minutes <= 930;
  // Global FX roughly open Sun 22:00 UTC → Fri 22:00 UTC (we approximate
  // as one of NY/London/Tokyo being active). Simplified: open on weekdays.
  return {
    open: nseOpen,
    label: nseOpen ? 'NSE / BSE Open' : 'Markets Closed',
    detail: nseOpen ? 'Indian equity session live' : 'Equity session closed',
  };
}

export function Header() {
  const [now, setNow] = useState<string>('');
  const [market, setMarket] = useState<MarketStatus>({ open: false, label: 'Markets Closed', detail: '' });

  useEffect(() => {
    const update = () => {
      setNow(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          timeZone: 'Asia/Calcutta',
        }),
      );
      setMarket(computeMarketStatus());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/10 bg-black/30 px-4 backdrop-blur-2xl [transform:translateZ(0)] md:px-6">
      {/* Gradient bottom border — blue→transparent */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-blue-500/0 via-blue-500/40 to-blue-500/0"
      />
      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <MobileNav />
        </SheetContent>
      </Sheet>

      <CommandPaletteTrigger />

      <div className="ml-auto flex items-center gap-2">
        {/* Market status badge — minimalist pill */}
        <div
          className={cn(
            'hidden sm:flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
            market.open
              ? 'border-blue-500/20 bg-blue-500/[0.08] text-blue-500'
              : 'border-white/10 bg-white/[0.04] text-muted-foreground',
          )}
          title={market.detail}
        >
          <span className="relative flex h-1.5 w-1.5 select-none">
            {market.open && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
            )}
            <span
              className={cn(
                'relative inline-flex h-1.5 w-1.5 rounded-full',
                market.open ? 'bg-blue-500' : 'bg-muted-foreground/50',
              )}
            />
          </span>
          <span className="select-none">{market.label}</span>
        </div>

        {/* IST clock — clean, minimal */}
        <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 select-none">
            IST
          </span>
          <span className="font-mono text-[13px] font-medium tabular-nums text-foreground/90">
            {now || '--:--:--'}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          asChild
          className="relative rounded-full focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:bg-white/[0.06] transition-colors duration-200"
        >
          <Link href="/notifications" aria-label="View notifications">
            <Bell className="h-[18px] w-[18px] text-muted-foreground hover:text-foreground transition-colors" strokeWidth={1.75} />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-blue-500" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
