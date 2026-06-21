import { MarketsClient } from '@/components/markets/MarketsClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Markets — OMNISCIENT',
  description:
    'Unified global markets dashboard — forex, stocks (NSE/BSE + US), indices, and commodities with live quotes and sparklines.',
};

export default function MarketsPage() {
  return <MarketsClient />;
}
