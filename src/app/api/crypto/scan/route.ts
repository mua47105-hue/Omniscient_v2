/**
 * Crypto scan API — deep multi-asset scan that fetches klines + orderbook +
 * funding for every active crypto asset, computes indicators + consensus,
 * and returns the fused analysis results.
 *
 * GET /api/crypto/scan
 *
 * This is the same logic the scheduler uses to scan + persist signals, but
 * exposed as a read-only endpoint for the UI. The result is a snapshot — it
 * does NOT write to the DB (the scheduler handles that).
 *
 * Returns one row per asset with:
 *   - ticker (lastPrice, changePct, volume)
 *   - indicators (RSI/MACD/EMA/BB/VWAP/trend/5-vote summary)
 *   - orderbook layer (bid/ask imbalance score)
 *   - consensus direction + conviction + summaryScore
 *   - entry / stop / takeProfit (computed from ATR)
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getKlines, getOrderBook, getFundingRate } from '@/lib/market/binance';
import { computeIndicators } from '@/lib/market/indicators';
import {
  buildTechnicalLayer,
  buildOrderbookLayer,
  computeConsensus,
} from '@/lib/analysis/consensus';
import type { Kline, TechnicalIndicators, ConsensusResult, FundingRate } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface AssetScanRow {
  symbol: string;
  name: string;
  price: number;
  changePct24h: number;
  quoteVolume: number;
  indicators: TechnicalIndicators;
  orderbookImbalance: number; // -1..1
  fundingRate: number | null;
  consensus: ConsensusResult;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  errors: string[];
}

/**
 * Compute entry / stop / takeProfit from the latest close + ATR(14).
 *   entry  = lastClose
 *   stop   = lastClose - 1.5 × ATR (long) / + 1.5 × ATR (short)
 *   tp     = lastClose + 3.0 × ATR (long) / - 3.0 × ATR (short)
 * Returns undefined values if ATR is null.
 */
function computeTradeLevels(
  ind: TechnicalIndicators,
  direction: 'long' | 'short' | 'neutral',
): { entry?: number; stopLoss?: number; takeProfit?: number } {
  if (!ind.lastClose || !ind.atr14 || direction === 'neutral') {
    return {};
  }
  const entry = ind.lastClose;
  const atr = ind.atr14;
  if (direction === 'long') {
    return {
      entry,
      stopLoss: entry - 1.5 * atr,
      takeProfit: entry + 3.0 * atr,
    };
  }
  return {
    entry,
    stopLoss: entry + 1.5 * atr,
    takeProfit: entry - 3.0 * atr,
  };
}

export async function GET() {
  try {
    const assets = await db.asset.findMany({
      where: { assetClass: 'crypto', isActive: true },
      select: { symbol: true, name: true },
    });

    const rows: AssetScanRow[] = [];

    await Promise.all(
      assets.map(async (a) => {
        const errors: string[] = [];
        try {
          // Fetch klines + orderbook + funding in parallel.
          const [klines, ob, funding] = await Promise.all([
            getKlines(a.symbol, '4h', 200).catch((e) => {
              errors.push(`klines: ${(e as Error).message}`);
              return [] as Kline[];
            }),
            getOrderBook(a.symbol, 50).catch((e) => {
              errors.push(`orderbook: ${(e as Error).message}`);
              return null;
            }),
            getFundingRate(a.symbol).catch((e) => {
              errors.push(`funding: ${(e as Error).message}`);
              return null as FundingRate | null;
            }),
          ]);

          if (klines.length < 30) {
            errors.push('insufficient klines');
            return;
          }

          const ind = computeIndicators(klines);
          const technicalLayer = buildTechnicalLayer(ind);

          let orderbookImbalance = 0;
          let orderbookLayer = null;
          if (ob) {
            orderbookLayer = buildOrderbookLayer(ob, 10);
            orderbookImbalance = (orderbookLayer.score ?? 0) / 100;
          }

          const consensus = computeConsensus({
            symbol: a.symbol,
            assetClass: 'crypto',
            technical: technicalLayer,
            orderbook: orderbookLayer ?? undefined,
          });

          const { entry, stopLoss, takeProfit } = computeTradeLevels(
            ind,
            consensus.direction,
          );

          // 24h % change — last 6 4h-bars approximates 24h.
          const recent = klines.slice(-6);
          const start = recent[0]?.open ?? recent[0]?.close ?? 0;
          const end = recent[recent.length - 1]?.close ?? 0;
          const changePct24h = start > 0 ? ((end - start) / start) * 100 : 0;
          const quoteVolume = klines.slice(-6).reduce((s, k) => s + (k.quoteVolume ?? 0), 0);

          rows.push({
            symbol: a.symbol,
            name: a.name,
            price: ind.lastClose ?? 0,
            changePct24h,
            quoteVolume,
            indicators: ind,
            orderbookImbalance,
            fundingRate: funding?.fundingRate ?? null,
            consensus,
            entry,
            stopLoss,
            takeProfit,
            errors,
          });
        } catch (e) {
          errors.push(`fatal: ${(e as Error).message}`);
        }
      }),
    );

    // Sort by conviction desc, then by |summaryScore| desc.
    rows.sort((a, b) => {
      if (b.consensus.conviction !== a.consensus.conviction) {
        return b.consensus.conviction - a.consensus.conviction;
      }
      return Math.abs(b.consensus.summaryScore) - Math.abs(a.consensus.summaryScore);
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
