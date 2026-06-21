import { HeatMapClient } from '@/components/markets/HeatMapClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Heat Map — OMNISCIENT',
  description:
    'One glance at the whole market — treemap-style heat map of every asset across crypto, forex, stocks, indices, and commodities, sized by absolute daily move and colored by direction.',
};

export default function HeatMapPage() {
  return <HeatMapClient />;
}
