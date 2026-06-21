import { CorrelationMatrixClient } from '@/components/correlation/CorrelationMatrixClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Correlation Matrix — OMNISCIENT',
  description:
    'Multi-asset Pearson correlation matrix with diversification scoring — see how crypto, forex, commodities, indices, and stocks move together. Spot redundancy risks and hedge opportunities at a glance.',
};

export default function CorrelationPage() {
  return <CorrelationMatrixClient />;
}
