// IPO & ICO pipeline — fetches upcoming IPOs and new crypto listings via web
// search, then uses LLM to extract structured data (name, price, date,
// assessment) from the raw search results.
import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import { resolveModel, completeWithAutoFallback } from '@/lib/llm/router';
import { IPO_EXTRACTION_SYSTEM, ICO_EXTRACTION_SYSTEM } from '@/lib/llm/prompts';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface IpoIcoItem {
  type: 'ipo' | 'ico';
  name: string;
  symbol?: string;
  date?: string;
  exchange?: string;
  offerPrice?: string;
  valuation?: string;
  details: string;
  assessment?: 'positive' | 'neutral' | 'negative';
  assessmentReason?: string;
  source?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// Web search — fetches raw results
// ---------------------------------------------------------------------------
async function webSearch(query: string, num: number): Promise<any[]> {
  const zai = await ZAI.create();
  const results = await zai.functions.invoke('web_search', {
    query,
    num,
    recency_days: 7,
  });
  return results as any[];
}

// ---------------------------------------------------------------------------
// LLM extraction — parses raw search results into structured IPO/ICO items
// ---------------------------------------------------------------------------
function buildExtractionPrompt(type: 'ipo' | 'ico', rawResults: any[]): string {
  const formatted = rawResults
    .map((r, i) => {
      const title = r.name || r.title || '';
      const snippet = r.snippet || r.description || '';
      const url = r.url || '';
      return `${i + 1}. Title: ${title}\n   Snippet: ${snippet}\n   URL: ${url}`;
    })
    .join('\n\n');

  if (type === 'ipo') {
    return `You are a financial analyst specializing in IPOs. From the web search results below, extract a JSON array of upcoming or recent IPOs. For each IPO, provide:
- name: Company name (exact, not the website name)
- symbol: Ticker symbol if available (e.g., "RELIANCE", "AAPL"), or null
- date: Expected IPO date if available (ISO format or "2025-06-15"), or null
- exchange: Exchange (e.g., "NASDAQ", "NSE", "BSE", "NYSE"), or null
- offerPrice: Offer price range if available (e.g., "$18-$20" or "₹250-₹300"), or null
- valuation: Expected valuation if available (e.g., "$2B"), or null
- assessment: "positive" | "neutral" | "negative" based on the company's fundamentals, sector sentiment, and market conditions
- assessmentReason: 1-sentence reasoning for the assessment
- source: Website name where this info was found

Only include REAL upcoming/recent IPOs with actual company names. Do NOT include generic pages like "IPO Calendar" or "IPO News" — extract the actual companies listed.

Search results:
${formatted}

Respond with ONLY a JSON array, no prose. If no real IPOs are found, respond with [].`;
  }

  return `You are a crypto analyst specializing in token launches. From the web search results below, extract a JSON array of upcoming or recent ICOs/IDOs/IEOs. For each token, provide:
- name: Token/project name (exact, e.g., "Polygon", "Arbitrum")
- symbol: Token symbol if available (e.g., "MATIC", "ARB"), or null
- date: Launch/sale date if available, or null
- exchange: Launch platform if available (e.g., "Binance Launchpad", "CoinList"), or null
- offerPrice: Token sale price if available (e.g., "$0.05"), or null
- valuation: Target raise or valuation if available (e.g., "$10M raise"), or null
- assessment: "positive" | "neutral" | "negative" based on the project's technology, team, tokenomics, and market sentiment
- assessmentReason: 1-sentence reasoning for the assessment
- source: Website name where this info was found

Only include REAL token launches with actual project names. Do NOT include generic pages like "ICO List" or "ICO Drops" — extract the actual tokens listed.

Search results:
${formatted}

Respond with ONLY a JSON array, no prose. If no real ICOs are found, respond with [].`;
}

function extractJsonArray(content: string): any[] {
  if (!content) return [];
  // Strip code fences if present
  const cleaned = content
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  // Try direct parse
  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v;
  } catch {
    // fall through
  }
  // Find the first '[' ... matching ']'
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    if (Array.isArray(v)) return v;
  } catch {
    return [];
  }
  return [];
}

async function extractWithLLM(
  type: 'ipo' | 'ico',
  rawResults: any[]
): Promise<IpoIcoItem[]> {
  // Try LLM extraction; fall back to raw results if LLM fails
  try {
    // Try the module-specific config first, then fall back to any active provider
    let llmCfg = await resolveModel('ipo_ico_analysis', 'analysis');
    
    if (!llmCfg) {
      // No module config — use any active provider with a real key
      const { db } = await import('@/lib/db');
      const providers = await db.llmProvider.findMany({
        where: { isActive: true },
        include: { models: { where: { isActive: true }, take: 1 } },
      });
      const usable = providers.find(
        (p) => p.models.length > 0 && !p.apiKey.startsWith('PASTE_') && !p.apiKey.startsWith('YOUR_')
      );
      if (usable) {
        llmCfg = {
          providerName: usable.name,
          modelId: usable.models[0].modelId,
          temperature: 0.2,
          systemPrompt: undefined,
          baseUrl: usable.baseUrl,
          apiKey: usable.apiKey,
        };
      }
    }

    if (!llmCfg) {
      // No LLM configured at all — use raw results
      return rawResults.map((r) => ({
        type,
        name: r.name?.split(' - ')[0]?.split(' | ')[0]?.slice(0, 80) || r.name?.slice(0, 80) || 'Unknown',
        date: r.date,
        exchange: r.host_name,
        details: r.snippet?.slice(0, 250) || '',
        source: r.host_name,
        url: r.url,
      }));
    }

    const prompt = buildExtractionPrompt(type, rawResults);
    const result = await completeWithAutoFallback({
      provider: llmCfg.providerName,
      model: llmCfg.modelId,
      messages: [
        {
          role: 'system',
          content: type === 'ipo' ? IPO_EXTRACTION_SYSTEM : ICO_EXTRACTION_SYSTEM,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      jsonMode: true,
      maxTokens: 2000,
    });

    const extracted = extractJsonArray(result.content);
    if (extracted.length === 0) {
      // LLM returned empty — fall back to raw
      return rawResults.map((r) => ({
        type,
        name: r.name?.split(' - ')[0]?.split(' | ')[0]?.slice(0, 80) || r.name?.slice(0, 80) || 'Unknown',
        date: r.date,
        exchange: r.host_name,
        details: r.snippet?.slice(0, 250) || '',
        source: r.host_name,
        url: r.url,
      }));
    }

    // Map extracted items to IpoIcoItem
    return extracted
      .filter((item) => item.name && item.name !== 'Unknown')
      .slice(0, 10)
      .map((item) => ({
        type,
        name: String(item.name).slice(0, 120),
        symbol: item.symbol || undefined,
        date: item.date || undefined,
        exchange: item.exchange || item.source || undefined,
        offerPrice: item.offerPrice || undefined,
        valuation: item.valuation || undefined,
        details: item.assessmentReason || item.details || '',
        assessment: (item.assessment as 'positive' | 'neutral' | 'negative') || undefined,
        assessmentReason: item.assessmentReason || undefined,
        source: item.source || undefined,
      }));
  } catch (e) {
    console.log(`[ipo-ico] LLM extraction failed for ${type}, using raw results:`, (e as any)?.message?.slice(0, 80));
    // Fall back to raw results
    return rawResults.map((r) => ({
      type,
      name: r.name?.split(' - ')[0]?.split(' | ')[0]?.slice(0, 80) || r.name?.slice(0, 80) || 'Unknown',
      date: r.date,
      exchange: r.host_name,
      details: r.snippet?.slice(0, 250) || '',
      source: r.host_name,
      url: r.url,
    }));
  }
}

// ---------------------------------------------------------------------------
// Main handlers
// ---------------------------------------------------------------------------
async function fetchIpos(): Promise<IpoIcoItem[]> {
  const raw = await webSearch('upcoming IPO calendar 2025 new stock listings this week next month company name offer price', 15);
  return extractWithLLM('ipo', raw);
}

async function fetchIcos(): Promise<IpoIcoItem[]> {
  const raw = await webSearch('new cryptocurrency ICO token launch IDO presale 2025 upcoming token sale price', 15);
  return extractWithLLM('ico', raw);
}

export async function GET(req: NextRequest) {
  try {
    const type = req.nextUrl.searchParams.get('type') || 'all'; // ipo | ico | all
    const [ipos, icos] = await Promise.all([
      type === 'all' || type === 'ipo' ? fetchIpos() : Promise.resolve([]),
      type === 'all' || type === 'ico' ? fetchIcos() : Promise.resolve([]),
    ]);

    // Persist to DB (best-effort)
    const all = [...ipos, ...icos];
    for (const item of all.slice(0, 12)) {
      try {
        await db.ipoIcoItem.create({
          data: {
            type: item.type,
            name: item.name,
            symbol: item.symbol,
            date: item.date ? new Date(item.date) : null,
            exchange: item.exchange,
            details: JSON.stringify({
              details: item.details,
              source: item.source,
              url: item.url,
              offerPrice: item.offerPrice,
              valuation: item.valuation,
              assessment: item.assessment,
              assessmentReason: item.assessmentReason,
            }),
          },
        }).catch(() => {});
      } catch {}
    }

    return NextResponse.json<ApiResult<{ ipos: IpoIcoItem[]; icos: IpoIcoItem[] }>>({
      success: true,
      data: { ipos, icos },
    });
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>({ success: false, error: e.message }, { status: 500 });
  }
}
