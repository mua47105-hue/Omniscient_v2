'use client';

import * as React from 'react';
import Link from 'next/link';
import { Heart, Settings2 } from 'lucide-react';
import { FooterBrainIndicator } from '@/components/brain/FooterBrainIndicator';

/**
 * App-wide footer. Sits at the bottom of the main column (mt-auto) so the
 * layout always fills the viewport. Includes the brain-health indicator on the
 * left, configuration link on the right.
 */
export function Footer(): React.ReactElement {
  return (
    <footer className="mt-auto border-t border-border bg-background/60 px-4 py-3 md:px-6">
      <div className="flex flex-col items-center justify-between gap-2 text-[11px] text-muted-foreground md:flex-row">
        <div className="flex items-center gap-3">
          <FooterBrainIndicator />
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden sm:inline">OMNISCIENT · market intelligence</span>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Settings2 className="h-3 w-3" />
            Configuration
          </Link>
          <span className="inline-flex items-center gap-1">
            Built with <Heart className="h-3 w-3 fill-rose-500 text-rose-500" /> on free APIs
          </span>
        </div>
      </div>
    </footer>
  );
}
