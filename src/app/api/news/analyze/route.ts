// News Sentiment LLM Analysis — batch-analyzes a list of articles in a single LLM call.
// Tiered: returns {analyzed: false, message} gracefully if no LLM is configured,
// so the news page never crashes — the user simply sees a "configure" hint.
import { NextRequest, NextResponse } from 'next/server';
import { resolveModel, completeWithAutoFallback } from '@/lib/llm/router';
import { NEWS_SENTIMENT_SYSTEM } from '@/lib/llm/prompts';
import { extractJsonArray } from '@/lib/llm/json';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ArticleInput {
  title: string;
  snippet?: string;
  source: string;
}

interface SentimentResult {
  sentiment: number; // -100..100
  impact: 'low' | 'medium' | 'high';
  assetsTagged: string[];
  oneLineSummary: string;
}

interface SentimentSummary {
  avgSentiment: number;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  topAssets: { asset: string; mentions: number; avgSentiment: number }[];
}

interface AnalyzedResponse {
  analyzed: true;
  results: SentimentResult[];
  summary: SentimentSummary;
  model?: string;
  latencyMs?: number;
}

interface NotAnalyzedResponse {
  analyzed: false;
  message: string;
}

function buildPrompt(articles: ArticleInput[]): string {
  const lines = articles
    .map((a, i) => {
      const snip = a.snippet ? ` — ${a.snippet}` : '';
      return `${i + 1}. [${a.source || 'source'}] ${a.title}${snip}`;
    })
    .join('\n');
  return `You are a financial news sentiment analyst. For each article below, return a JSON array (same order) with:
- sentiment: number from -100 (very bearish) to 100 (very bullish)
- impact: "low" | "medium" | "high"
- assetsTagged: array of asset symbols mentioned (e.g. ["BTC","ETH","DXY","Gold"])
- oneLineSummary: string (max 120 chars)

Articles:
${lines}

Respond with ONLY the JSON array, no prose.`;
}

/** Extract the first JSON array found in a string (handles code-fence + preamble).
 *  Now delegates to the shared @/lib/llm/json utility which also handles smart
 *  quotes, trailing commas, and nested structures more robustly. */

function normalizeResult(raw: any, index: number): SentimentResult {
  const sentimentRaw = Number(raw?.sentiment);
  const sentiment = Number.isFinite(sentimentRaw)
    ? Math.max(-100, Math.min(100, sentimentRaw))
    : 0;
  const impactRaw = String(raw?.impact ?? '').toLowerCase();
  const impact: SentimentResult['impact'] =
    impactRaw === 'high' || impactRaw === 'medium' || impactRaw === 'low'
      ? impactRaw
      : 'medium';
  const assetsTagged: string[] = Array.isArray(raw?.assetsTagged)
    ? raw.assetsTagged
        .map((x: any) => String(x).trim())
        .filter((x: string) => x.length > 0 && x.length <= 16)
        .slice(0, 8)
    : [];
  const oneLineSummary = String(raw?.oneLineSummary ?? '').slice(0, 160);
  return { sentiment, impact, assetsTagged, oneLineSummary };
}

function buildSummary(results: SentimentResult[]): SentimentSummary {
  if (results.length === 0) {
    return {
      avgSentiment: 0,
      bullishCount: 0,
      bearishCount: 0,
      neutralCount: 0,
      topAssets: [],
    };
  }
  let sum = 0;
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  const assetAgg = new Map<string, { mentions: number; sentimentSum: number }>();
  for (const r of results) {
    sum += r.sentiment;
    if (r.sentiment > 20) bullish++;
    else if (r.sentiment < -20) bearish++;
    else neutral++;
    for (const a of r.assetsTagged) {
      const key = a.toUpperCase();
      const prev = assetAgg.get(key) ?? { mentions: 0, sentimentSum: 0 };
      assetAgg.set(key, {
        mentions: prev.mentions + 1,
        sentimentSum: prev.sentimentSum + r.sentiment,
      });
    }
  }
  const topAssets = Array.from(assetAgg.entries())
    .map(([asset, agg]) => ({
      asset,
      mentions: agg.mentions,
      avgSentiment: agg.sentimentSum / agg.mentions,
    }))
    .sort((a, b) => b.mentions - a.mentions || Math.abs(b.avgSentiment) - Math.abs(a.avgSentiment))
    .slice(0, 8);
  return {
    avgSentiment: Math.round((sum / results.length) * 10) / 10,
    bullishCount: bullish,
    bearishCount: bearish,
    neutralCount: neutral,
    topAssets,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const articles: ArticleInput[] = Array.isArray(body?.articles) ? body.articles : [];
    if (articles.length === 0) {
      const resp: NotAnalyzedResponse = {
        analyzed: false,
        message: 'No articles provided for analysis.',
      };
      return NextResponse.json<ApiResult<NotAnalyzedResponse | AnalyzedResponse>>({
        success: true,
        data: resp,
      });
    }

    // Cap batch size to keep token budgets sane.
    const batch = articles.slice(0, 25);

    // Tiered: resolve configured LLM. If nothing is wired, return gracefully.
    const cfg = await resolveModel('news_sentiment', 'sentiment');
    if (!cfg) {
      const resp: NotAnalyzedResponse = {
        analyzed: false,
        message:
          'No LLM configured for news_sentiment. Go to Settings → LLM Providers → Module Config to wire a model.',
      };
      return NextResponse.json<ApiResult<NotAnalyzedResponse | AnalyzedResponse>>({
        success: true,
        data: resp,
      });
    }

    const prompt = buildPrompt(batch);
    let result;
    try {
      result = await completeWithAutoFallback({
        provider: cfg.providerName,
        model: cfg.modelId,
        messages: [
          {
            role: 'system',
            content:
              cfg.systemPrompt ||
              NEWS_SENTIMENT_SYSTEM,
          },
          { role: 'user', content: prompt },
        ],
        temperature: cfg.temperature ?? 0.2,
        jsonMode: true,
        maxTokens: 2000,
      });
    } catch (e: any) {
      const resp: NotAnalyzedResponse = {
        analyzed: false,
        message: `LLM call failed: ${e?.message || 'unknown error'}`,
      };
      return NextResponse.json<ApiResult<NotAnalyzedResponse | AnalyzedResponse>>({
        success: true,
        data: resp,
      });
    }

    const parsed = extractJsonArray(result.content);
    if (!parsed || parsed.length === 0) {
      console.error('[news/analyze] LLM returned unparseable content. First 200 chars:', result.content?.slice(0, 200));
      const resp: NotAnalyzedResponse = {
        analyzed: false,
        message: 'LLM returned no parseable JSON array. Try again or try a different model.',
      };
      return NextResponse.json<ApiResult<NotAnalyzedResponse | AnalyzedResponse>>({
        success: true,
        data: resp,
      });
    }

    // Map back to articles by index. If the LLM returned fewer entries, pad with neutral.
    const results: SentimentResult[] = batch.map((_, i) => {
      const raw = parsed[i];
      if (raw && typeof raw === 'object') {
        return normalizeResult(raw, i);
      }
      return normalizeResult({}, i);
    });

    const summary = buildSummary(results);
    const resp: AnalyzedResponse = {
      analyzed: true,
      results,
      summary,
      model: `${cfg.providerName}/${cfg.modelId}`,
      latencyMs: result.latencyMs,
    };
    return NextResponse.json<ApiResult<AnalyzedResponse>>({ success: true, data: resp });
  } catch (e: any) {
    // Never crash the UI — return analyzed:false on unexpected errors.
    const resp: NotAnalyzedResponse = {
      analyzed: false,
      message: `Analysis failed: ${e?.message || 'unknown error'}`,
    };
    return NextResponse.json<ApiResult<NotAnalyzedResponse | AnalyzedResponse>>({
      success: true,
      data: resp,
    });
  }
}
