import { StrategyBuilderClient } from '@/components/strategy/StrategyBuilderClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Strategy Builder — OMNISCIENT',
  description:
    'Design, backtest, and deploy a complete trading strategy in one flow — connect screener filters → backtest engine → live alerts.',
};

export default function StrategyBuilderPage() {
  return <StrategyBuilderClient />;
}
