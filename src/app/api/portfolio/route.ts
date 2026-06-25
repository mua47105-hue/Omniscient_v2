// Portfolio API — track user holdings with live P&L across all asset classes.
//   GET    /api/portfolio                       → list holdings + computed P&L + totals
//   POST   /api/portfolio                      → create new holding
//   DELETE /api/portfolio?id=...                → delete a holding
// Schema-version-aware db singleton — see src/lib/db.ts.
import { validateBody, schemas } from "@/lib/api/validation";

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTickers24h } from '@/lib/market/binance';
import { getQuoteWithFallback } from '@/lib/market/macro';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PortfolioHoldingWithPnl {
  id: string;
  assetSymbol: string;
  name: string;
  assetClass: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  notes: string | null;
  currentPrice: number | null;
  currentValue: number;
  totalCost: number;
  pnl: number;
  pnlPct: number;
  dayChangePct: number | null;
  source: 'binance' | 'yahoo' | 'unknown';
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioTotals {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPct: number;
  bestPerformer: { symbol: string; pnlPct: number } | null;
  worstPerformer: { symbol: string; pnlPct: number } | null;
}

export interface PortfolioResponse {
  holdings: PortfolioHoldingWithPnl[];
  totals: PortfolioTotals;
}

// ---------------------------------------------------------------------------
// GET — list holdings with live prices + P&L
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const rows = await db.portfolioHolding.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (rows.length === 0) {
      const emptyTotals: PortfolioTotals = {
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPct: 0,
        bestPerformer: null,
        worstPerformer: null,
      };
      return NextResponse.json<ApiResult<PortfolioResponse>>({
        success: true,
        data: { holdings: [], totals: emptyTotals },
      });
    }

    // Look up Asset metadata for each holding symbol (assetClass + yahooSymbol + name)
    const symbols = [...new Set(rows.map((r) => r.assetSymbol))];
    const assets = await db.asset.findMany({ where: { symbol: { in: symbols } } });
    const assetMap = new Map<string, (typeof assets)[number]>();
    for (const a of assets) assetMap.set(a.symbol, a);

    // Group holdings by data source: crypto → Binance batch, others → Yahoo sequential
    const cryptoSymbols: string[] = [];
    const yahooSymbols: string[] = []; // yahooSymbol (resolved from meta.yahooSymbol)

    for (const r of rows) {
      const a = assetMap.get(r.assetSymbol);
      const assetClass = a?.assetClass || guessClassFromSymbol(r.assetSymbol);
      if (assetClass === 'crypto') {
        cryptoSymbols.push(r.assetSymbol);
      } else {
        let meta: any = {};
        try { meta = JSON.parse(a?.meta || '{}'); } catch {}
        const yahooSym = meta.yahooSymbol || r.assetSymbol;
        yahooSymbols.push(yahooSym);
      }
    }

    // Fetch prices in parallel: Binance batch (fast) + Yahoo sequential (slow but rate-limit-safe)
    const [cryptoTickers, yahooQuotes] = await Promise.all([
      cryptoSymbols.length > 0
        ? getTickers24h(cryptoSymbols).catch((e: any) => {
            console.error('[portfolio] Binance batch failed:', e.message);
            return [] as Awaited<ReturnType<typeof getTickers24h>>;
          })
        : Promise.resolve([] as Awaited<ReturnType<typeof getTickers24h>>),
      (async () => {
        const out: Record<string, { price: number; changePct: number }> = {};
        for (const ys of yahooSymbols) {
          try {
            const q = await getQuoteWithFallback(ys, '5d');
            out[ys] = { price: q.price, changePct: q.changePct };
          } catch (e: any) {
            console.error(`[portfolio] Yahoo ${ys} failed:`, e.message);
          }
        }
        return out;
      })(),
    ]);

    const cryptoPriceMap = new Map<string, { price: number; changePct: number }>();
    for (const t of cryptoTickers) {
      cryptoPriceMap.set(t.symbol, { price: t.price, changePct: t.changePct });
    }

    // Build holdings with P&L
    const holdings: PortfolioHoldingWithPnl[] = rows.map((r) => {
      const a = assetMap.get(r.assetSymbol);
      const assetClass = a?.assetClass || guessClassFromSymbol(r.assetSymbol);
      let meta: any = {};
      try { meta = JSON.parse(a?.meta || '{}'); } catch {}

      let currentPrice: number | null = null;
      let dayChangePct: number | null = null;
      let source: 'binance' | 'yahoo' | 'unknown' = 'unknown';

      if (assetClass === 'crypto') {
        const t = cryptoPriceMap.get(r.assetSymbol);
        if (t) {
          currentPrice = t.price;
          dayChangePct = t.changePct;
          source = 'binance';
        }
      } else {
        const yahooSym = meta.yahooSymbol || r.assetSymbol;
        const q = yahooQuotes[yahooSym];
        if (q) {
          currentPrice = q.price;
          dayChangePct = q.changePct;
          source = 'yahoo';
        }
      }

      const totalCost = r.quantity * r.entryPrice;
      const currentValue = currentPrice != null ? r.quantity * currentPrice : 0;
      const pnl = currentPrice != null ? currentValue - totalCost : 0;
      const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

      return {
        id: r.id,
        assetSymbol: r.assetSymbol,
        name: a?.name || r.assetSymbol,
        assetClass,
        quantity: r.quantity,
        entryPrice: r.entryPrice,
        entryDate: r.entryDate.toISOString(),
        notes: r.notes,
        currentPrice,
        currentValue,
        totalCost,
        pnl,
        pnlPct,
        dayChangePct,
        source,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });

    // Totals + best/worst
    const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
    const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
    const totalPnl = holdings.reduce((s, h) => s + h.pnl, 0);
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    const withPrices = holdings.filter((h) => h.currentPrice != null);
    let bestPerformer: PortfolioTotals['bestPerformer'] = null;
    let worstPerformer: PortfolioTotals['worstPerformer'] = null;
    if (withPrices.length > 0) {
      const sorted = [...withPrices].sort((a, b) => b.pnlPct - a.pnlPct);
      bestPerformer = { symbol: sorted[0].assetSymbol, pnlPct: sorted[0].pnlPct };
      worstPerformer = { symbol: sorted[sorted.length - 1].assetSymbol, pnlPct: sorted[sorted.length - 1].pnlPct };
    }

    const totals: PortfolioTotals = {
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPct,
      bestPerformer,
      worstPerformer,
    };

    return NextResponse.json<ApiResult<PortfolioResponse>>({
      success: true,
      data: { holdings, totals },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — create a holding
// ---------------------------------------------------------------------------
interface CreateBody {
  assetSymbol?: string;
  quantity?: number;
  entryPrice?: number;
  notes?: string;
  entryDate?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await validateBody(req, schemas.portfolio) as any;
    const assetSymbol = (body.assetSymbol || '').trim().toUpperCase();
    const quantity = Number(body.quantity);
    const entryPrice = Number(body.entryPrice);
    const notes = body.notes?.trim() || null;
    const entryDate = body.entryDate ? new Date(body.entryDate) : new Date();

    if (!assetSymbol) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'assetSymbol is required' },
        { status: 400 },
      );
    }
    if (!isFinite(quantity) || quantity <= 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'quantity must be a positive number' },
        { status: 400 },
      );
    }
    if (!isFinite(entryPrice) || entryPrice <= 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'entryPrice must be a positive number' },
        { status: 400 },
      );
    }
    if (isNaN(entryDate.getTime())) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'entryDate is not a valid date' },
        { status: 400 },
      );
    }

    const created = await db.portfolioHolding.create({
      data: {
        assetSymbol,
        quantity,
        entryPrice,
        notes,
        entryDate,
      },
    });
    return NextResponse.json<ApiResult<typeof created>>(
      { success: true, data: created },
      { status: 201 },
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a holding
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'id query param is required' },
        { status: 400 },
      );
    }
    await db.portfolioHolding.delete({ where: { id } });
    return NextResponse.json<ApiResult<{ id: string }>>({
      success: true,
      data: { id },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: e.message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function guessClassFromSymbol(symbol: string): string {
  const s = symbol.toUpperCase();
  // Crypto: Binance-style pairs end in USDT/USDC/BUSD/ETH/BTC
  if (/(USDT|USDC|BUSD|TUSD|FDUSD)$/.test(s) || /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|AVAX|DOT|MATIC)$/.test(s)) {
    return 'crypto';
  }
  if (s.includes('=X') || /^(EUR|GBP|AUD|NZD|USD|CAD|CHF|JPY|INR){3}$/.test(s)) return 'forex';
  if (s.endsWith('.NS') || s.endsWith('.BO')) return 'stock';
  if (s.startsWith('^') || s === 'SENSEX') return 'index';
  if (/^(GC|SI|CL|NG|ZC|ZW|ZS)=F$/.test(s) || /^(XAU|XAG|XPT|XPD)$/.test(s)) return 'commodity';
  return 'stock'; // default — most tickers like AAPL/MSFT are stocks
}
