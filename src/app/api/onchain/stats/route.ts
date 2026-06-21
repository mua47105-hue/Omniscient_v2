/**
 * On-chain stats API (blockchain.info).
 *
 * GET /api/onchain/stats
 *
 * Returns the 3 free stats (transactionCount24h, hashrate EH/s, difficulty)
 * plus the ring-buffer-derived hashrate trend. 15-min cache in the module.
 */
import { NextResponse } from 'next/server';
import {
  getOnChainStats,
  getOnchainTrend,
  getHashrateHistory,
} from '@/lib/market/onchain';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await getOnChainStats();
    const trend = getOnchainTrend();
    const history = getHashrateHistory();
    return NextResponse.json({
      success: true,
      data: { stats, trend, history },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
