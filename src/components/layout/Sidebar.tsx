'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavEntry {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional dynamic badge (e.g. unread notifications count). */
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavEntry[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/brain', label: 'Brain', icon: BrainCircuit },
    ],
  },
  {
    label: 'Markets',
    items: [
      { href: '/crypto', label: 'Crypto', icon: Bitcoin },
      { href: '/markets', label: 'Markets', icon: Globe2 },
      { href: '/heat-map', label: 'Heat Map', icon: Grid3x3 },
      { href: '/correlation', label: 'Correlation', icon: LayoutGrid },
      { href: '/screener', label: 'Screener', icon: ScanLine },
      { href: '/signals', label: 'Signals', icon: TrendingUp },
      { href: '/derivatives', label: 'Derivatives', icon: Layers },
      { href: '/multi-timeframe', label: 'Multi-TF', icon: Columns3 },
      { href: '/price-alerts', label: 'Alerts', icon: BellRing },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/portfolio', label: 'Portfolio', icon: Wallet },
      { href: '/risk-calculator', label: 'Risk Calc', icon: Calculator },
      { href: '/backtest', label: 'Backtest', icon: FlaskConical },
      { href: '/strategy-builder', label: 'Strategy Builder', icon: Workflow },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/news', label: 'News', icon: Newspaper },
      { href: '/macro', label: 'Macro', icon: Globe },
      { href: '/economic-calendar', label: 'Econ Calendar', icon: CalendarClock },
      { href: '/ipo-ico', label: 'IPO / ICO', icon: CalendarDays },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/llm-activity', label: 'LLM Activity', icon: Activity },
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/reports', label: 'Reports', icon: FileText },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

function useIstClock() {
  const [now, setNow] = useState<string>('');
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
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function SystemStatusPanel() {
  const now = useIstClock();
  return (
    <div className="border-t border-white/10 p-3">
      <div className="relative overflow-hidden rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 transition-all duration-200 hover:bg-white/[0.06]">
        <div className="relative flex items-center gap-2.5">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
          </span>
          <div className="flex flex-col leading-tight min-w-0 flex-1">
            <span className="text-[11px] font-medium text-foreground/80 truncate">
              All systems operational
            </span>
            <span className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
              <span className="select-none uppercase tracking-wider text-[9px]">IST</span>
              <span className="font-mono tabular-nums">{now || '--:--:--'}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItemLink({ item, active }: { item: NavEntry; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 ease-out outline-none',
        'focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        active
          ? 'bg-gradient-to-r from-blue-500/15 via-blue-500/[0.07] to-transparent text-foreground shadow-[inset_0_0_0_1px_rgba(10,132,255,0.18),0_4px_14px_-4px_rgba(10,132,255,0.35)]'
          : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground hover:translate-x-0.5',
      )}
    >
      {/* Active accent bar */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2.5px] rounded-r-full transition-all duration-200 ease-out',
          active
            ? 'bg-gradient-to-b from-blue-400 to-blue-600 opacity-100 shadow-[0_0_8px_rgba(10,132,255,0.7)]'
            : 'bg-transparent opacity-0 group-hover:opacity-30 group-hover:bg-blue-400/50',
        )}
      />
      <Icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-all duration-200 ease-out',
          active
            ? 'text-blue-500'
            : 'text-muted-foreground/70 group-hover:text-blue-500/90 group-hover:scale-105',
        )}
        strokeWidth={1.75}
      />
      <span className="truncate transition-transform duration-200 ease-out group-hover:translate-x-0.5">
        {item.label}
      </span>
      {active && !item.badge && (
        <span
          aria-hidden
          className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(10,132,255,0.9)] animate-pulse"
        />
      )}
      {item.badge != null && item.badge > 0 && (
        <span
          aria-label={`${item.badge} unread`}
          className={cn(
            'ml-auto inline-flex items-center justify-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none transition-all',
            'bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30',
            'group-hover:bg-blue-500/25 group-hover:scale-105',
          )}
        >
          {item.badge > 99 ? '99+' : item.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Listen for the global unread-count event dispatched by NotificationCenterClient.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onUnread = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setUnread(typeof detail === 'number' && isFinite(detail) ? detail : 0);
    };
    window.addEventListener('notifications-unread', onUnread as EventListener);
    return () => window.removeEventListener('notifications-unread', onUnread as EventListener);
  }, []);

  // Inject the dynamic unread badge into the Notifications nav entry.
  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map((it) =>
      it.href === '/notifications' ? { ...it, badge: unread } : it,
    ),
  }));

  return (
    <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 border-r border-white/10 bg-black/40 backdrop-blur-2xl [transform:translateZ(0)]">
      {/* Logo header */}
      <div className="relative flex h-16 items-center gap-3 px-5 border-b border-white/10 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(10,132,255,0.10),transparent_55%)] pointer-events-none"
        />
        <div className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-md shadow-blue-500/20 ring-1 ring-white/20">
          <span
            aria-hidden
            className="absolute inset-0 rounded-[10px] bg-blue-400/30 blur-md opacity-50 group-hover:opacity-80 transition-opacity duration-300"
          />
          <Activity className="relative h-[18px] w-[18px]" strokeWidth={2} />
        </div>
        <div className="relative flex flex-col leading-none gap-0.5">
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            OMNISCIENT
          </span>
          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-[0.16em] font-medium">
            Market Intel
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5 scrollbar-thin">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className="px-3 pb-1.5 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
                {group.label}
              </span>
              <span
                aria-hidden
                className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent"
              />
            </div>
            {group.items.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return <NavItemLink key={item.href} item={item} active={active} />;
            })}
          </div>
        ))}
      </nav>

      <SystemStatusPanel />
    </aside>
  );
}
