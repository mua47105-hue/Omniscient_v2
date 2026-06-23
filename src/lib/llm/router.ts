// LLM Router — multi-provider orchestration.
// Supports any OpenAI-compatible endpoint (Groq, NVIDIA NIM, Mistral, OpenRouter, xAI Grok)
// and Google Gemini natively. Reads provider configs from DB.
// ALL calls happen server-side only.
// Uses node:https to bypass Next.js fetch patching issues + Cloudflare bot detection.

import https from 'node:https';
import { db } from '@/lib/db';
import type { LlmCompletionRequest, LlmCompletionResponse, LlmMessage } from '@/lib/types';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function isGemNative(baseUrl: string) {
  return baseUrl.includes('generativelanguage.googleapis.com');
}

/** Detect OpenRouter — needs special headers (HTTP-Referer, X-OpenRouter-Title). */
function isOR(baseUrl: string) {
  return baseUrl.includes('openrouter.ai');
}

/** Native HTTPS POST — bypasses Next.js fetch patching + Cloudflare bot blocks.
 *  Timeout is 15s: long enough for any working model (Mistral 700ms, NIM Llama 200ms),
 *  short enough that the fallback chain doesn't waste 30s+ on a dead provider. */
function nativeHttpsPost(
  url: string,
  headers: Record<string, string>,
  bodyStr: string,
  timeoutMs = 15000
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: { 'User-Agent': UA, ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('LLM request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

/** Native HTTPS GET (for Gemini which uses GET-like POST with query params) */
function nativeHttpsPostGemini(
  url: string,
  bodyStr: string,
  timeoutMs = 15000
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Gemini request timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LlmCompletionResponse> {
  const start = Date.now();
  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  // Sanitize the API key before putting it in the Authorization header —
  // strip quotes, whitespace, and control chars that cause "Invalid character
  // in header content" errors.
  const safeKey = apiKey.replace(/^["'`]+|["'`]+$/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
  const { status, text } = await nativeHttpsPost(
    url,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeKey}`,
    },
    JSON.stringify(body)
  );

  // Handle error responses — detect HTML (some providers like Hugging Face
  // return HTML error pages on 429/500 instead of JSON).
  if (!status || status >= 400) {
    const isHtml = text.trimStart().startsWith('<') || text.trimStart().startsWith('!');
    if (isHtml) {
      // Extract the <title> from HTML for a meaningful error message
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch?.[1]?.trim() || 'HTML error page';
      if (status === 429) {
        throw new Error(`LLM 429: Rate limited (${title})`);
      }
      throw new Error(`LLM ${status}: ${title}`);
    }
    // JSON error — surface the actual message so users see "out of funds",
    // "invalid key", etc. instead of a generic message.
    let errMsg = text.slice(0, 300);
    try {
      const errJson = JSON.parse(text);
      // Try common error message fields
      errMsg = errJson?.error?.message || errJson?.error || errJson?.message || errMsg;
      if (typeof errMsg === 'object') errMsg = JSON.stringify(errMsg).slice(0, 200);
    } catch { /* keep raw text */ }
    if (status === 403) {
      throw new Error(`LLM 403: ${errMsg}`);
    }
    throw new Error(`LLM ${status}: ${errMsg}`);
  }

  // Success — parse JSON response
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`LLM ${status}: Invalid JSON response (possibly HTML): ${text.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content ?? '';
  return {
    content,
    model,
    usage: data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
      : undefined,
    latencyMs: Date.now() - start,
  };
}

/**
 * Call OpenRouter — same OpenAI-compatible API, but with OpenRouter-specific
 * headers (HTTP-Referer, X-OpenRouter-Title) as recommended in their docs.
 * These headers are optional but help with rankings + avoid some rate limits.
 * See: https://openrouter.ai/docs/api-reference/overview
 */
async function callOpenRouter(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LlmCompletionResponse> {
  const start = Date.now();
  const body: any = {
    model,
    messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  // Sanitize the API key (same as callOpenAICompatible)
  const safeKey = apiKey.replace(/^["'`]+|["'`]+$/g, '').replace(/[\x00-\x1F\x7F]/g, '').trim();
  const { status, text } = await nativeHttpsPost(
    url,
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${safeKey}`,
      // OpenRouter-specific headers (recommended in their API docs)
      'HTTP-Referer': 'https://omniscient.app',
      'X-Title': 'OMNISCIENT Market Intel',
    },
    JSON.stringify(body)
  );

  // Handle error responses — detect HTML (some providers return HTML error pages)
  if (!status || status >= 400) {
    const isHtml = text.trimStart().startsWith('<') || text.trimStart().startsWith('!');
    if (isHtml) {
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch?.[1]?.trim() || 'HTML error page';
      throw new Error(`LLM ${status}: ${title}`);
    }
    let errMsg = text.slice(0, 300);
    try {
      const errJson = JSON.parse(text);
      errMsg = errJson?.error?.message || errJson?.error || errJson?.message || errMsg;
      if (typeof errMsg === 'object') errMsg = JSON.stringify(errMsg).slice(0, 200);
    } catch { /* keep raw text */ }
    throw new Error(`LLM ${status}: ${errMsg}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`LLM ${status}: Invalid JSON response: ${text.slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content ?? '';
  return {
    content,
    model,
    usage: data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
      : undefined,
    latencyMs: Date.now() - start,
  };
}

async function callGeminiNative(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LlmCompletionResponse> {
  const start = Date.now();
  const sysMsg = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const body: any = {
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      ...(opts.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (sysMsg) body.systemInstruction = { parts: [{ text: sysMsg }] };

  const url = `${baseUrl.replace(/\/$/, '')}/models/${model}:generateContent?key=${apiKey}`;
  const { status, text } = await nativeHttpsPostGemini(url, JSON.stringify(body));

  // Handle error responses — surface the actual error message
  if (!status || status >= 400) {
    const isHtml = text.trimStart().startsWith('<') || text.trimStart().startsWith('!');
    if (isHtml) {
      const titleMatch = text.match(/<title>(.*?)<\/title>/i);
      throw new Error(`Gemini ${status}: ${titleMatch?.[1]?.trim() || 'HTML error'}`);
    }
    let errMsg = text.slice(0, 300);
    try {
      const errJson = JSON.parse(text);
      errMsg = errJson?.error?.message || errJson?.message || errMsg;
    } catch { /* keep raw text */ }
    throw new Error(`Gemini ${status}: ${errMsg}`);
  }

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Gemini ${status}: Invalid JSON response: ${text.slice(0, 200)}`);
  }
  const content = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  return {
    content,
    model,
    usage: data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount,
          completionTokens: data.usageMetadata.candidatesTokenCount,
        }
      : undefined,
    latencyMs: Date.now() - start,
  };
}

/** Get active provider+model from DB */
export async function getProviderConfig(providerName: string, modelId?: string) {
  const provider = await db.llmProvider.findFirst({
    where: { name: providerName, isActive: true },
    include: { models: { where: { isActive: true } } },
  });
  if (!provider) throw new Error(`Provider not found or inactive: ${providerName}`);
  const model = modelId
    ? provider.models.find((m) => m.modelId === modelId)
    : provider.models[0];
  if (!model) throw new Error(`No active model for provider ${providerName}`);
  return { provider, model };
}

// ---------------------------------------------------------------------------
// Multi-key rotation — a single LlmProvider.apiKey field can contain MULTIPLE
// keys separated by newlines. The router rotates through them, and when a key
// gets rate-limited (429) it enters a cooldown period (60s) during which it's
// skipped. This lets users paste 2+ keys per provider to multiply their
// effective rate limit.
// ---------------------------------------------------------------------------

/** Cooldown duration for a rate-limited key (60 seconds). */
const KEY_COOLDOWN_MS = 60_000;

/** Map of "providerName:keyHash" → cooldown-until timestamp. */
const keyCooldowns = new Map<string, number>();

/** Quick hash to identify a key without storing it in plain in the cooldown map. */
function keyHash(key: string): string {
  return key.slice(-8); // last 8 chars is enough to distinguish keys
}

/**
 * Split a provider's apiKey field into individual keys (newline-separated).
 * Also sanitizes each key: strips quotes, whitespace, and control characters
 * that would cause "Invalid character in header content" errors when the key
 * is used in the Authorization header.
 */
function parseKeys(apiKey: string): string[] {
  if (!apiKey || typeof apiKey !== 'string') return [];
  return apiKey
    .split('\n')
    .map((k) => k.trim())
    // Strip surrounding quotes (users sometimes paste "sk-or-..." with quotes)
    .map((k) => k.replace(/^["'`]+|["'`]+$/g, ''))
    // Remove any control characters / non-printable chars that break HTTP headers
    .map((k) => k.replace(/[\x00-\x1F\x7F]/g, ''))
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !k.startsWith('PASTE_') && !k.startsWith('YOUR_'));
}

/** Get the list of available (non-cooling-down) keys for a provider. */
function getAvailableKeys(providerName: string, apiKey: string): string[] {
  const allKeys = parseKeys(apiKey);
  if (allKeys.length === 0) return [];
  const now = Date.now();
  return allKeys.filter((k) => {
    const cd = keyCooldowns.get(`${providerName}:${keyHash(k)}`);
    return !cd || cd < now;
  });
}

/** Mark a specific key as rate-limited (enters cooldown). */
function markKeyRateLimited(providerName: string, key: string): void {
  keyCooldowns.set(`${providerName}:${keyHash(key)}`, Date.now() + KEY_COOLDOWN_MS);
  console.log(`[llm] Key ${providerName}:...${keyHash(key)} rate-limited — cooldown ${KEY_COOLDOWN_MS / 1000}s`);
}

/** Map provider name → HF Secret env var name for API key overrides.
 *  Set these as HF Space Secrets to override DB-stored keys (persists across restarts). */
const ENV_KEY_FOR_PROVIDER_STATIC: Record<string, string> = {
  'OpenRouter': 'OPENROUTER_API_KEY',
  'Groq': 'GROQ_API_KEY',
  'Gemini': 'GEMINI_API_KEY',
  'Mistral': 'MISTRAL_API_KEY',
  'NVIDIA NIM': 'NVIDIA_NIM_API_KEY',
  'Cerebras': 'CEREBRAS_API_KEY',
  'AIMLAPI': 'AIMLAPI_API_KEY',
  'SiliconFlow': 'SILICONFLOW_API_KEY',
  'xAI Grok': 'XAI_API_KEY',
  'Hugging Face': 'HUGGINGFACE_API_KEY',
};

/** Call a specific provider+model (internal) — with multi-key rotation + env-var override. */
async function callProvider(
  provider: { baseUrl: string; apiKey: string; name: string },
  modelId: string,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean }
): Promise<LlmCompletionResponse> {
  // Env-var override: HF Space Secrets can set provider-specific API keys
  // that override the DB-stored keys. This lets users set keys once in HF
  // Space Settings and have them persist across restarts without re-entering
  // in the UI.
  const envKeyName = ENV_KEY_FOR_PROVIDER_STATIC[provider.name];
  const envKey = envKeyName ? process.env[envKeyName] : undefined;
  const effectiveApiKey = envKey && envKey.length > 0 && !envKey.startsWith('PASTE_') ? envKey : provider.apiKey;

  const allKeys = parseKeys(effectiveApiKey);
  if (allKeys.length === 0) {
    throw new Error(`No API key configured for ${provider.name}` + (envKeyName ? ` (set ${envKeyName} as an HF Space Secret, or paste a key in Settings)` : ''));
  }

  // Try each available key in sequence. On 429, mark cooldown + try next.
  // If ALL keys are cooling down, try the first one anyway (maybe it recovered).
  let availableKeys = getAvailableKeys(provider.name, effectiveApiKey);
  if (availableKeys.length === 0) {
    // All keys in cooldown — try the first one (best effort)
    availableKeys = [allKeys[0]];
  }

  let lastErr: unknown;
  for (const key of availableKeys) {
    try {
      if (isGemNative(provider.baseUrl)) {
        return await callGeminiNative(provider.baseUrl, key, modelId, messages, opts);
      }
      if (isOR(provider.baseUrl)) {
        return await callOpenRouter(provider.baseUrl, key, modelId, messages, opts);
      }
      return await callOpenAICompatible(provider.baseUrl, key, modelId, messages, opts);
    } catch (e: any) {
      const msg = e.message || '';
      // 429 = rate limited → mark this key and try the next
      if (msg.includes('429') || msg.includes('rate limit')) {
        markKeyRateLimited(provider.name, key);
        lastErr = e;
        continue; // try next key
      }
      // 403/timeout/other → don't retry with same provider, throw immediately
      throw e;
    }
  }
  // All keys exhausted
  throw lastErr ?? new Error(`All API keys for ${provider.name} are rate-limited`);
}

/** Generic completion — auto-detects Gemini vs OpenAI-compatible */
export async function complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
  const { provider, model } = await getProviderConfig(req.provider, req.model);
  return callProvider(provider, model.modelId, req.messages, req);
}

/**
 * Complete with AUTOMATIC provider fallback.
 * Tries the requested provider first; if it fails (403/429/timeout/etc),
 * automatically tries ALL other active providers with their first active model.
 * Returns the first successful result, tagged with which provider/model was actually used.
 */
export async function completeWithAutoFallback(
  req: LlmCompletionRequest
): Promise<LlmCompletionResponse & { usedProvider?: string; usedModel?: string; fallbackUsed?: boolean }> {
  // Try the requested provider first
  try {
    const result = await complete(req);
    return { ...result, usedProvider: req.provider, usedModel: req.model, fallbackUsed: false };
  } catch (primaryErr: any) {
    console.log(`[llm] Primary provider ${req.provider} failed: ${primaryErr.message.slice(0, 100)} — trying fallbacks...`);

    // Get all other active providers
    const allProviders = await db.llmProvider.findMany({
      where: { isActive: true, name: { not: req.provider } },
      include: { models: { where: { isActive: true }, take: 1 } },
    });

    // Sort fallback providers by reliability priority.
    // Providers known to work reliably from this server come first; providers
    // that are frequently IP-blocked or rate-limited come last. This minimizes
    // the time spent in the fallback chain before reaching a working provider.
    const PRIORITY: Record<string, number> = {
      'Pollinations': 1,  // completely free, no API key, always available (~800ms)
      'Mistral': 2,       // works reliably (~700ms)
      'NVIDIA NIM': 3,    // works with llama-3.3-70b (~200ms)
      'OpenRouter': 4,    // works with paid llama-3.3-70b (~400ms)
      'Cerebras': 5,      // ultra-fast when configured (1000+ tok/s)
      'AIMLAPI': 6,       // 400+ models when configured
      'SiliconFlow': 7,   // open-source models when configured
      'Hugging Face': 8,  // free tier when configured
      'xAI Grok': 9,      // free $25 credit when configured
      'Gemini': 10,       // often 429 (quota) or 400 (geo-block)
      'Groq': 11,         // 403 Cloudflare IP block from datacenter IPs
    };
    const sorted = [...allProviders].sort((a, b) => (PRIORITY[a.name] ?? 99) - (PRIORITY[b.name] ?? 99));

    for (const p of sorted) {
      if (p.models.length === 0) continue;
      // Skip providers with placeholder keys — UNLESS an env-var override exists.
      // HF Space Secrets can set provider keys that override the DB placeholders.
      const envKeyName = ENV_KEY_FOR_PROVIDER_STATIC[p.name];
      const hasEnvOverride = envKeyName && process.env[envKeyName] && !process.env[envKeyName]!.startsWith('PASTE_');
      if (!hasEnvOverride && (p.apiKey.startsWith('PASTE_') || p.apiKey.startsWith('YOUR_'))) continue;
      try {
        const result = await callProvider(p, p.models[0].modelId, req.messages, req);
        console.log(`[llm] Fallback to ${p.name}/${p.models[0].modelId} succeeded`);
        return {
          ...result,
          model: result.model, // keep original model name
          usedProvider: p.name,
          usedModel: p.models[0].modelId,
          fallbackUsed: true,
        };
      } catch (e: any) {
        console.log(`[llm] Fallback ${p.name} also failed: ${e.message.slice(0, 80)}`);
      }
    }

    // All providers failed — throw the original error
    throw primaryErr;
  }
}

/** Complete with explicit fallback chain — try providers in order until one succeeds */
export async function completeWithFallback(
  chain: LlmCompletionRequest[]
): Promise<{ result: LlmCompletionResponse; usedIndex: number }> {
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    try {
      const result = await complete(chain[i]);
      return { result, usedIndex: i };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All providers failed');
}

/** Resolve the configured model for a module+layer, fall back to defaults */
export async function resolveModel(moduleKey: string, layer: string) {
  const cfg = await db.moduleModelConfig.findFirst({
    where: { moduleKey, layer, enabled: true },
    include: { model: { include: { provider: true } }, provider: true },
  });
  if (cfg) {
    return {
      providerName: cfg.provider.name,
      modelId: cfg.model.modelId,
      temperature: cfg.temperature,
      systemPrompt: cfg.systemPrompt,
      baseUrl: cfg.provider.baseUrl,
      apiKey: cfg.provider.apiKey,
    };
  }
  return null;
}
