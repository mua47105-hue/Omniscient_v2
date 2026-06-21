'use client';

import * as React from 'react';
import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * App-wide providers. Composes:
 *   - ThemeProvider (next-themes) — locked to dark for OMNISCIENT
 *   - QueryProvider (react-query) — server-state cache + refetch intervals
 *   - TooltipProvider — Radix tooltip portal root
 */
export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false}>
      <QueryProvider>
        <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
