import { CryptoAssetClient } from '@/components/crypto/CryptoAssetClient';

export const dynamic = 'force-dynamic';

export default async function Page({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <CryptoAssetClient symbol={decodeURIComponent(symbol)} />;
}
