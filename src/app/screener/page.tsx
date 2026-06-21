import { ScreenerClient } from '@/components/screener/ScreenerClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Market Screener — OMNISCIENT',
  description:
    'Scan the entire crypto universe with 14 technical filters — RSI, MACD, EMA crosses, Bollinger squeezes, volume spikes, S/R proximity. Surface high-conviction opportunities in seconds.',
};

export default function ScreenerPage() {
  return <ScreenerClient />;
}
