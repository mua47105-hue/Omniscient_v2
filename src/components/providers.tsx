'use client';

import { ThemeProvider } from 'next-themes';
import { QueryProvider } from '@/components/providers/QueryProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <QueryProvider>{children}</QueryProvider>
    </ThemeProvider>
  );
}
