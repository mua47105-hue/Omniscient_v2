/**
 * IPO / ICO API — list upcoming offerings + LLM analysis.
 *
 * GET /api/ipo-ico?type=ipo|ico|all&limit=50
 *   Returns IpoIcoItem records, newest first.
 *
 * POST /api/ipo-ico
 *   Body: { id, analyze?: boolean } | { create: true, ...fields }
 *   - With { id, analyze: true }: runs LLM analysis on the stored item and
 *     persists the analysis text back to the row.
 *   - Otherwise: creates a new item.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { completeWithAutoFallback } from '@/lib/llm/router';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type'); // 'ipo' | 'ico' | null = all
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') ?? '50', 10) || 50));

    const rows = await db.ipoIcoItem.findMany({
      where: type && ['ipo', 'ico'].includes(type) ? { type } : undefined,
      orderBy: { date: 'asc' },
      take: limit,
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — analyze or create
// ---------------------------------------------------------------------------

interface AnalyzeBody {
  id?: string;
  analyze?: boolean;
  create?: boolean;
  type?: string;
  name?: string;
  symbol?: string;
  date?: string;
  exchange?: string;
  details?: Record<string, unknown>;
}

export async function POST(req: Request) {
  try {
    let body: AnalyzeBody;
    try {
      body = (await req.json()) as AnalyzeBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'invalid JSON body' },
        { status: 400 },
      );
    }

    // Analyze path
    if (body.id && body.analyze) {
      const item = await db.ipoIcoItem.findUnique({ where: { id: body.id } });
      if (!item) {
        return NextResponse.json(
          { success: false, error: 'item not found' },
          { status: 404 },
        );
      }

      const prompt = `You are OMNISCIENT, an IPO/ICO investment analyst.
Analyze the following offering and return STRICT JSON only:
{
  "thesis": "<= 280 chars investment thesis>",
  "risks": ["risk1", "risk2", "risk3"],
  "catalysts": ["catalyst1", "catalyst2"],
  "verdict": "bullish" | "neutral" | "bearish",
  "conviction": 0-100
}

Offering:
- Type: ${item.type}
- Name: ${item.name}
- Symbol: ${item.symbol ?? 'n/a'}
- Date: ${item.date ? new Date(item.date).toISOString().slice(0, 10) : 'TBD'}
- Exchange: ${item.exchange ?? 'n/a'}
- Details: ${item.details ?? '{}'}`;

      try {
        const resp = await completeWithAutoFallback({
          messages: [
            { role: 'system', content: 'You are a senior equity/token offering analyst.' },
            { role: 'user', content: prompt },
          ],
          moduleKey: 'markets_analysis',
          layer: 'ipo_ico',
          temperature: 0.4,
          maxTokens: 500,
        });

        // Persist the raw text analysis. (We don't parse — UI can show it raw.)
        const analysis = resp.text.trim();
        const updated = await db.ipoIcoItem.update({
          where: { id: item.id },
          data: { analysis },
        });

        return NextResponse.json({
          success: true,
          data: updated,
          provider: resp.provider,
          model: resp.model,
        });
      } catch (err) {
        return NextResponse.json(
          { success: false, error: `LLM analysis failed: ${(err as Error).message}` },
          { status: 502 },
        );
      }
    }

    // Create path
    if (body.create) {
      if (!body.type || !body.name) {
        return NextResponse.json(
          { success: false, error: 'type and name required for create' },
          { status: 400 },
        );
      }
      const row = await db.ipoIcoItem.create({
        data: {
          type: body.type,
          name: body.name,
          symbol: body.symbol ?? null,
          date: body.date ? new Date(body.date) : null,
          exchange: body.exchange ?? null,
          details: JSON.stringify(body.details ?? {}),
        },
      });
      return NextResponse.json({ success: true, data: row });
    }

    return NextResponse.json(
      { success: false, error: 'provide {id, analyze:true} or {create:true,...}' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
