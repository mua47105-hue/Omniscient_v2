import { AssetDetailClient } from '@/components/markets/AssetDetailClient';

export const dynamic = 'force-dynamic';

export default async function MarketAssetPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<React.ReactElement> {
  const { symbol } = await params;
  // Decode percent-encoded Yahoo symbols (^GSPC, EURUSD=X, etc.)
  const decoded = decodeURIComponent(symbol);
  return <AssetDetailClient symbol={decoded} />;
}
