'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { CommandPalette } from '@/components/dashboard/CommandPalette';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Lock page: render standalone (no sidebar, no header, no footer)
  if (pathname === '/lock') {
    return (
      <div className="relative min-h-screen flex flex-col">
        <div
          aria-hidden
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle 900px at 0% 0%, oklch(0.55 0.28 255 / 0.65), transparent 55%),' +
              'radial-gradient(circle 800px at 100% 15%, oklch(0.60 0.25 300 / 0.55), transparent 55%),' +
              'radial-gradient(circle 700px at 30% 100%, oklch(0.65 0.25 160 / 0.50), transparent 55%),' +
              'radial-gradient(circle 600px at 80% 70%, oklch(0.60 0.22 70 / 0.45), transparent 55%)',
          }}
        />
        {children}
      </div>
    );
  }

  // All other pages: full dashboard with sidebar + header + footer
  return (
    <div className="relative min-h-screen flex flex-col">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle 900px at 0% 0%, oklch(0.55 0.28 255 / 0.65), transparent 55%),' +
            'radial-gradient(circle 800px at 100% 15%, oklch(0.60 0.25 300 / 0.55), transparent 55%),' +
            'radial-gradient(circle 700px at 30% 100%, oklch(0.65 0.25 160 / 0.50), transparent 55%),' +
            'radial-gradient(circle 600px at 80% 70%, oklch(0.60 0.22 70 / 0.45), transparent 55%),' +
            'radial-gradient(circle 500px at 50% 50%, oklch(0.55 0.20 340 / 0.30), transparent 60%)',
        }}
      />
      <Sidebar />
      <div className="flex flex-col md:pl-64 min-h-screen">
        <Header />
        <main className="flex-1 px-4 py-6 md:px-6 md:py-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
        <Footer />
      </div>
      <CommandPalette />
    </div>
  );
}
