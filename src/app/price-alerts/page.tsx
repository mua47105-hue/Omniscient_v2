import { PriceAlertsClient } from '@/components/alerts/PriceAlertsClient';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Price Alerts — OMNISCIENT',
  description:
    'Set threshold alerts on any asset — crypto, forex, stocks, indices, commodities. Get notified on the dashboard or via Telegram when prices cross your targets.',
};

export default function PriceAlertsPage() {
  return <PriceAlertsClient />;
}
