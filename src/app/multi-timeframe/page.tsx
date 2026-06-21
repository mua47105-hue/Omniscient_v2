import { MultiTimeframeClient } from '@/components/multi-timeframe/MultiTimeframeClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Multi-Timeframe Analysis — OMNISCIENT',
  description:
    'One asset across 1h / 4h / 1d / 1w simultaneously with a confluence score, agreement matrix, and entry/exit suggestions.',
};

export default function MultiTimeframePage() {
  return <MultiTimeframeClient />;
}
