/**
 * Signals API.
 *
 * GET /api/signals?limit=50
 *   Returns the most recent signals, including the parent asset + any
 *   SignalOutcome grades. Newest first.
 *
 * POST /api/signals
 *   Manual signal creation — body: {assetId|symbol, direction, conviction,
 *   rationale, timeframe?, entryPrice?, stopLoss?, takeProfit?}. Used by the
 *   strategy builder / manual signal entry UI.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get('limit') ?? '50';
    const limit = Math.max(1, Math.min(500, parseInt(limitRaw, 10) || 50));
    const status = searchParams.get('status'); // 'open' | 'closed' | null

    const signals = await db.signal.findMany({
      where: status ? { status } : undefined,
      include: {
        asset: true,
        outcomes: { orderBy: { gradedAt: 'desc' }, take: 1 },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: signals });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

interface CreateSignalBody {
  assetId?: string;
  symbol?: string;
  direction: 'long' | 'short' | 'neutral';
  conviction: number;
  rationale?: string;
  timeframe?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  layersSummary?: Record<string, unknown>;
}

export async function POST(req: Request) {
  try {
    let body: CreateSignalBody;
    try {
      body = (await req.json()) as CreateSignalBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    if (!body.direction || !['long', 'short', 'neutral'].includes(body.direction)) {
      return NextResponse.json(
        { success: false, error: 'direction must be long|short|neutral' },
        { status: 400 },
      );
    }

    // Resolve asset by id or symbol.
    let assetId = body.assetId;
    if (!assetId && body.symbol) {
      const asset = await db.asset.findUnique({
        where: { symbol: body.symbol.toUpperCase() },
      });
      if (!asset) {
        return NextResponse.json(
          { success: false, error: `asset not found: ${body.symbol}` },
          { status: 404 },
        );
      }
      assetId = asset.id;
    }
    if (!assetId) {
      return NextResponse.json(
        { success: false, error: 'provide assetId or symbol' },
        { status: 400 },
      );
    }

    const conviction = Math.max(0, Math.min(100, Math.round(body.conviction ?? 0)));
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // 4h

    const signal = await db.signal.create({
      data: {
        assetId,
        direction: body.direction,
        conviction,
        timeframe: body.timeframe ?? '4h',
        layersSummary: JSON.stringify(body.layersSummary ?? { manual: true }),
        modelsUsed: JSON.stringify(['manual']),
        entryPrice: body.entryPrice ?? null,
        stopLoss: body.stopLoss ?? null,
        takeProfit: body.takeProfit ?? null,
        rationale: body.rationale ?? '[manual] user-created signal',
        status: 'open',
        expiresAt,
      },
      include: { asset: true },
    });
    return NextResponse.json({ success: true, data: signal });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
