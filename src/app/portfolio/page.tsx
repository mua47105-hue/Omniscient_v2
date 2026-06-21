import { PortfolioClient } from '@/components/portfolio/PortfolioClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Portfolio — OMNISCIENT',
  description:
    'Track your holdings across all asset classes — crypto, forex, stocks, indices, commodities — with live P&L, allocation, and best/worst performers.',
};

export default function PortfolioPage() {
  return <PortfolioClient />;
}
