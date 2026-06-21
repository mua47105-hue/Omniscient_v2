/**
 * News sentiment analysis — POST /api/news/analyze
 *
 * Body: { id: string }
 *   - Looks up the NewsItem by id.
 *   - Runs LLM sentiment analysis (NEWS_SENTIMENT_SYSTEM prompt).
 *   - Persists sentiment, impact, assetsTagged back to the row.
 *   - Returns the updated NewsItem.
 *
 * Uses completeWithAutoFallback for provider resilience.
 */
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { completeWithAutoFallback } from '@/lib/llm/router';
import { NEWS_SENTIMENT_SYSTEM } from '@/lib/llm/prompts';

export const dynamic = 'force-dynamic';

interface AnalyzeBody {
  id?: string;
}

interface SentimentResult {
  sentiment?: number;
  impact?: 'low' | 'medium' | 'high';
  assetsTagged?: string[];
  summary?: string;
}

function safeParseJson(text: string): SentimentResult | null {
  // Strip markdown code fences if present.
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  }
  // Find the first {...} block.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1)) as SentimentResult;
  } catch {
    return null;
  }
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

    if (!body.id) {
      return NextResponse.json(
        { success: false, error: 'id required' },
        { status: 400 },
      );
    }

    const item = await db.newsItem.findUnique({ where: { id: body.id } });
    if (!item) {
      return NextResponse.json(
        { success: false, error: 'news item not found' },
        { status: 404 },
      );
    }

    const userPrompt = `Analyze this financial news headline. Return STRICT JSON only.

Title: ${item.title}
${item.body ? `Body: ${item.body.slice(0, 600)}` : ''}`;

    const resp = await completeWithAutoFallback({
      messages: [
        { role: 'system', content: NEWS_SENTIMENT_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      moduleKey: 'news_sentiment',
      layer: 'analyze',
      temperature: 0.2,
      maxTokens: 300,
    });

    const parsed = safeParseJson(resp.text);
    if (!parsed) {
      return NextResponse.json(
        {
          success: false,
          error: 'LLM did not return parseable JSON',
          raw: resp.text.slice(0, 500),
        },
        { status: 502 },
      );
    }

    const sentiment =
      typeof parsed.sentiment === 'number'
        ? Math.max(-1, Math.min(1, parsed.sentiment))
        : null;
    const impact =
      parsed.impact && ['low', 'medium', 'high'].includes(parsed.impact)
        ? parsed.impact
        : null;
    const assetsTagged = Array.isArray(parsed.assetsTagged)
      ? parsed.assetsTagged.map((s) => String(s)).slice(0, 10)
      : [];

    const updated = await db.newsItem.update({
      where: { id: item.id },
      data: {
        sentiment,
        impact,
        assetsTagged: JSON.stringify(assetsTagged),
        analyzed: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: updated,
      summary: parsed.summary,
      provider: resp.provider,
      model: resp.model,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
