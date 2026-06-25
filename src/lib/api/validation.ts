// Shared Zod validation helper for API POST routes.
//
// Usage in a route:
//   import { validateBody, schemas } from '@/lib/api/validation';
//   const body = await validateBody(req, schemas.cryptoScan);
//
// If validation fails, the helper throws a Response with 400 + Zod error.
// If the body is not valid JSON, it throws a Response with 400 + "Invalid JSON".

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/** Validate a request body against a Zod schema. Returns the parsed body or throws an Error. */
export async function validateBody<T>(req: NextRequest, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new Error('Invalid JSON body');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const firstError = result.error.issues[0];
    const message = firstError
      ? `${firstError.path.join('.')}: ${firstError.message}`
      : 'Validation failed';
    throw new Error(message);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Schemas for all POST routes
// ---------------------------------------------------------------------------

export const schemas = {
  // Auth
  login: z.object({
    password: z.string().min(1),
  }),

  // Crypto scan
  cryptoScan: z.object({
    symbol: z.string().min(1),
    interval: z.string().optional().default('4h'),
    sendAlert: z.boolean().optional().default(false),
  }),

  // Markets scan
  marketsScan: z.object({
    symbol: z.string().min(1),
    interval: z.string().optional().default('1d'),
    sendAlert: z.boolean().optional().default(false),
  }),

  // LLM providers
  llmProviders: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    baseUrl: z.string().url(),
    apiKey: z.string(),
    notes: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }),

  // LLM models
  llmModels: z.object({
    id: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    contextWindow: z.number().int().positive().optional().default(128000),
    freeTierRpm: z.number().int().positive().optional().default(10),
    isActive: z.boolean().optional().default(true),
  }),

  // LLM module configs
  llmModuleConfigs: z.object({
    id: z.string().optional(),
    moduleKey: z.string().min(1),
    layer: z.string().min(1),
    modelId: z.string().min(1),
    providerId: z.string().min(1),
    temperature: z.number().min(0).max(2).optional().default(0.3),
    systemPrompt: z.string().nullable().optional(),
    enabled: z.boolean().optional().default(true),
  }),

  // LLM presets
  llmPresets: z.object({
    name: z.string().min(1),
    apiKey: z.string().optional(),
  }),

  // LLM test
  llmTest: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }),

  // Brain
  brain: z.object({
    action: z.enum(['pause', 'resume', 'forceRun', 'resetBudget', 'setMode', 'setConfig', 'manualMode']),
    symbol: z.string().optional(),
    mode: z.enum(['auto', 'manual']).optional(),
  }).passthrough(),

  // News analyze — frontend sends all fetched articles (up to 50);
  // backend internally caps to 25 per batch (route.ts line 153)
  newsAnalyze: z.object({
    articles: z.array(z.object({
      title: z.string().min(1).max(500),
      snippet: z.string().max(2000).optional(),
      source: z.string().max(200).optional(),
      url: z.string().url().optional(),
      publishedAt: z.string().optional(),
    })).min(1).max(100),
  }),

  // Portfolio
  portfolio: z.object({
    action: z.string().optional(),
    assetSymbol: z.string().min(1).optional(),
    quantity: z.number().positive().optional(),
    entryPrice: z.number().positive().optional(),
    entryDate: z.string().optional(),
    notes: z.string().optional(),
    id: z.string().optional(),
  }).passthrough(),

  // Price alerts
  priceAlerts: z.object({
    assetSymbol: z.string().min(1),
    condition: z.enum(['above', 'below', 'crosses_up', 'crosses_down']),
    targetPrice: z.number().positive(),
    channel: z.enum(['dashboard', 'telegram', 'both']).optional().default('dashboard'),
    note: z.string().optional(),
  }),

  // Price alerts check
  priceAlertsCheck: z.object({}).passthrough(),

  // Screener scan
  screenerScan: z.object({
    filters: z.array(z.string()).optional().default([]),
    volumeMin: z.number().optional().default(1_000_000),
    priceMin: z.number().optional().default(0),
    priceMax: z.number().optional().default(0),
    direction: z.enum(['all', 'bullish', 'bearish']).optional().default('all'),
    sortBy: z.string().optional().default('volume'),
    topN: z.number().int().positive().optional().default(80),
    limit: z.number().int().positive().optional().default(200),
  }).passthrough(),

  // Settings
  settings: z.object({}).passthrough(),

  // Signals grade
  signalsGrade: z.object({
    signalId: z.string().min(1),
  }),

  // Signals (POST — create)
  signals: z.object({}).passthrough(),

  // Supabase sync
  supabaseSync: z.object({}).passthrough(),

  // Supabase test
  supabaseTest: z.object({
    url: z.string().optional(),
    anonKey: z.string().optional(),
  }).passthrough(),

  // Telegram test
  telegramTest: z.object({}).passthrough(),

  // Watchlists
  watchlists: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    assetClass: z.string().nullable().optional(),
    symbols: z.string().optional(),
    isActive: z.boolean().optional(),
  }).passthrough(),

  // Scheduler tick
  schedulerTick: z.object({}).passthrough(),

  // Auth logout
  authLogout: z.object({}).passthrough(),
};
