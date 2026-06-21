import { AssetDetailClient } from '@/components/markets/AssetDetailClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Asset Detail — OMNISCIENT',
  description:
    'Deep-analysis terminal for forex, stocks, indices, and commodities — technical indicators, multi-layer consensus, and AI deep analysis on daily timeframe.',
};

export default async function Page({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <AssetDetailClient symbol={decodeURIComponent(symbol)} />;
}
