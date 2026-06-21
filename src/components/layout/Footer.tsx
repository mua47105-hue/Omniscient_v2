import Link from 'next/link';
import { Activity, Heart } from 'lucide-react';

export function Footer() {
  return (
    <footer className="mt-auto border-t border-white/10 bg-black/30 backdrop-blur-2xl [transform:translateZ(0)]">
      <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row md:px-6">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-blue-500" />
          <span className="font-medium">OMNISCIENT</span>
          <span className="hidden sm:inline">· Global Market Intelligence · 24/7</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="hover:text-foreground transition-colors">
            Configuration
          </Link>
          <span className="hidden sm:inline">Free-tier stack</span>
          <span className="flex items-center gap-1">
            Built with <Heart className="h-3 w-3 fill-rose-500 text-rose-500" /> on free APIs
          </span>
        </div>
      </div>
    </footer>
  );
}
