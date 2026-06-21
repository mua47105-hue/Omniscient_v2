'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Bitcoin,
  TrendingUp,
  Newspaper,
  CalendarDays,
  BarChart3,
  FileText,
  Settings,
  Globe,
  Globe2,
  Activity,
  BellRing,
  Bell,
  Grid3x3,
  LayoutGrid,
  ScanLine,
  Wallet,
  CalendarClock,
  Calculator,
  FlaskConical,
  Layers,
  Workflow,
  Columns3,
  BrainCircuit,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/brain', label: 'Brain', icon: BrainCircuit },
  { href: '/crypto', label: 'Crypto', icon: Bitcoin },
  { href: '/markets', label: 'Markets', icon: Globe2 },
  { href: '/heat-map', label: 'Heat Map', icon: Grid3x3 },
  { href: '/correlation', label: 'Correlation', icon: LayoutGrid },
  { href: '/screener', label: 'Screener', icon: ScanLine },
  { href: '/signals', label: 'Signals', icon: TrendingUp },
  { href: '/derivatives', label: 'Derivatives', icon: Layers },
  { href: '/multi-timeframe', label: 'Multi-TF', icon: Columns3 },
  { href: '/price-alerts', label: 'Alerts', icon: BellRing },
  { href: '/portfolio', label: 'Portfolio', icon: Wallet },
  { href: '/risk-calculator', label: 'Risk Calc', icon: Calculator },
  { href: '/backtest', label: 'Backtest', icon: FlaskConical },
  { href: '/strategy-builder', label: 'Strategy Builder', icon: Workflow },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/macro', label: 'Macro', icon: Globe },
  { href: '/economic-calendar', label: 'Econ Calendar', icon: CalendarClock },
  { href: '/ipo-ico', label: 'IPO / ICO', icon: CalendarDays },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 px-6 border-b border-white/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
          <Activity className="h-5 w-5" />
        </div>
        <span className="text-sm font-bold tracking-tight">OMNISCIENT</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant={active ? 'secondary' : 'ghost'}
                className={cn('w-full justify-start gap-3 h-10')}
              >
                <Icon className={cn('h-4 w-4', active && 'text-emerald-500')} />
                {item.label}
              </Button>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
