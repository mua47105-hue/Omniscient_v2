import { DerivativesClient } from '@/components/derivatives/DerivativesClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Derivatives Analytics — OMNISCIENT',
  description:
    'Funding rates, open interest, long/short ratios, and taker buy/sell volume from Binance Futures. Surface market positioning, leverage sentiment, and smart-money direction.',
};

export default function DerivativesPage() {
  return <DerivativesClient />;
}
