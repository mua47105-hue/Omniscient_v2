'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BrainCircuit,
  CandlestickChart,
  Flame,
  GitCompareArrows,
  Filter,
  Radio,
  Layers3,
  BellRing,
  Wallet,
  Calculator,
  History,
  Wrench,
  BarChart3,
  Newspaper,
  Globe2,
  CalendarClock,
  Rocket,
  Settings,
  Bell,
  FileText,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      { label: 'Lazy Brain', href: '/brain', icon: BrainCircuit },
    ],
  },
  {
    title: 'Markets',
    items: [
      { label: 'Crypto', href: '/crypto', icon: CandlestickChart },
      { label: 'Markets', href: '/markets', icon: Globe2 },
      { label: 'Heat Map', href: '/heat-map', icon: Flame },
      { label: 'Correlation', href: '/correlation', icon: GitCompareArrows },
      { label: 'Screener', href: '/screener', icon: Filter },
      { label: 'Signals', href: '/signals', icon: Radio },
      { label: 'Derivatives', href: '/derivatives', icon: Layers3 },
      { label: 'Multi-Timeframe', href: '/multi-timeframe', icon: BarChart3 },
      { label: 'Price Alerts', href: '/price-alerts', icon: BellRing },
    ],
  },
  {
    title: 'Tools',
    items: [
      { label: 'Portfolio', href: '/portfolio', icon: Wallet },
      { label: 'Risk Calculator', href: '/risk-calculator', icon: Calculator },
      { label: 'Backtest', href: '/backtest', icon: History },
      { label: 'Strategy Builder', href: '/strategy-builder', icon: Wrench },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
      { label: 'News', href: '/news', icon: Newspaper },
      { label: 'Macro', href: '/macro', icon: Globe2 },
      { label: 'Economic Calendar', href: '/economic-calendar', icon: CalendarClock },
      { label: 'IPO / ICO', href: '/ipo-ico', icon: Rocket },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Notifications', href: '/notifications', icon: Bell },
      { label: 'Reports', href: '/reports', icon: FileText },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

function useIstClock(): string {
  const [time, setTime] = React.useState<string>('--:--:--');
  React.useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const tick = () => setTime(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function Sidebar(): React.ReactElement {
  const pathname = usePathname();
  const istTime = useIstClock();

  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15">
          <BrainCircuit className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold tracking-wide text-foreground">OMNISCIENT</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            market intelligence
          </span>
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-5">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/70">
              {group.title}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  pathname === item.href ||
                  (item.href !== '/' && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[10px] text-muted-foreground">All systems operational</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Activity className="h-3 w-3 text-emerald-400" />
            <span>{istTime} IST</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export { NAV_GROUPS };
