import { CryptoAssetClient } from '@/components/crypto/CryptoAssetClient';

export const dynamic = 'force-dynamic';

export default async function CryptoAssetPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<React.ReactElement> {
  const { symbol } = await params;
  return <CryptoAssetClient symbol={symbol} />;
}
