/**
 * Multi-provider LLM router.
 *
 *  - Uses `node:https` for ALL provider calls. Bypasses Next.js fetch
 *    patching + avoids Cloudflare bot detection on free providers
 *    (Pollinations, OpenRouter).
 *  - Multi-key rotation: providers store newline-separated keys. On HTTP 429
 *    we put the offending key on a 60s cooldown and rotate to the next.
 *  - `complete(req)` — call one specific provider (resolved from
 *    `preferProvider` or the module config).
 *  - `completeWithAutoFallback(req)` — try the requested provider, then walk
 *    the active providers by reliability priority until one succeeds.
 *  - `resolveModel(moduleKey, layer)` — looks up the ModuleModelConfig row
 *    for (moduleKey, layer) and returns {provider, model, temperature}.
 *
 *  Supported providers (by `name` in LlmProvider table):
 *    pollinations, gemini, groq, nvidia, mistral, openrouter
 *    (and any other OpenAI-compatible endpoint via callOpenAICompatible).
 */
import https from 'node:https';
import { URL } from 'node:url';
import db from '@/lib/db';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmMessage,
  ModuleKey,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Key rotation state (per-key cooldown on 429)
// ---------------------------------------------------------------------------

interface KeyState {
  cooldownUntil: number;
}

const keyStates = new Map<string, KeyState>();
const KEY_COOLDOWN_MS = 60_000;

function pickKey(providerName: string, rawKeys: string): string | null {
  const keys = rawKeys
    .split(/\r?\n/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (!keys.length) return null;
  const now = Date.now();
  for (const k of keys) {
    const state = keyStates.get(`${providerName}:${k}`);
    if (!state || state.cooldownUntil <= now) return k;
  }
  // All keys on cooldown — return the soonest-available anyway.
  return keys[0];
}

function markKeyRateLimited(providerName: string, key: string): void {
  keyStates.set(`${providerName}:${key}`, {
    cooldownUntil: Date.now() + KEY_COOLDOWN_MS,
  });
}

// ---------------------------------------------------------------------------
// httpsRequest — generic POST via node:https
// ---------------------------------------------------------------------------

interface HttpResult {
  status: number;
  body: string;
}

function httpsRequest(
  urlString: string,
  opts: { method: string; headers: Record<string, string>; body?: string },
  timeoutMs = 30_000,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: opts.method,
        headers: opts.headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`LLM request timeout (${timeoutMs}ms) for ${urlString}`));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Provider config + model resolution
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string; // active rotated key (may be empty for Pollinations)
  apiKeyRaw: string; // all keys (newline-separated)
  isActive: boolean;
}

export async function getProviderConfig(name: string): Promise<ProviderConfig | null> {
  const row = await db.llmProvider.findUnique({ where: { name } });
  if (!row) return null;
  const key = pickKey(name, row.apiKey || '');
  return {
    name: row.name,
    baseUrl: row.baseUrl,
    apiKey: key || '',
    apiKeyRaw: row.apiKey || '',
    isActive: row.isActive,
  };
}

export async function getActiveProviders(): Promise<ProviderConfig[]> {
  const rows = await db.llmProvider.findMany({ where: { isActive: true } });
  return rows.map((r: any) => ({
    name: r.name,
    baseUrl: r.baseUrl,
    apiKey: pickKey(r.name, r.apiKey || '') || '',
    apiKeyRaw: r.apiKey || '',
    isActive: r.isActive,
  }));
}

export interface ResolvedModel {
  provider: ProviderConfig;
  modelId: string;
  temperature: number;
  systemPrompt?: string | null;
}

/**
 * Look up the (moduleKey, layer) → provider+model+temperature config.
 */
export async function resolveModel(
  moduleKey: ModuleKey | string,
  layer: string,
): Promise<ResolvedModel | null> {
  const cfg = await db.moduleModelConfig.findUnique({
    where: {
      moduleKey_layer: { moduleKey: moduleKey as string, layer: layer as string },
    },
    include: { provider: true, model: true },
  });
  if (!cfg || !cfg.enabled) return null;
  const prov = cfg.provider;
  if (!prov || !prov.isActive) return null;
  return {
    provider: {
      name: prov.name,
      baseUrl: prov.baseUrl,
      apiKey: pickKey(prov.name, prov.apiKey || '') || '',
      apiKeyRaw: prov.apiKey || '',
      isActive: prov.isActive,
    },
    modelId: cfg.model?.modelId || '',
    temperature: cfg.temperature,
    systemPrompt: cfg.systemPrompt,
  };
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

/**
 * OpenAI-compatible chat completions. Used by: pollinations, groq, nvidia,
 * mistral, openrouter, plus any custom OpenAI-compatible endpoint.
 */
export async function callOpenAICompatible(
  cfg: ProviderConfig,
  req: LlmCompletionRequest,
  modelId: string,
  temperature = 0.3,
): Promise<LlmCompletionResponse> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = JSON.stringify({
    model: modelId,
    messages: req.messages,
    temperature,
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  const res = await httpsRequest(url, { method: 'POST', headers, body });
  if (res.status === 429) {
    if (cfg.apiKey) markKeyRateLimited(cfg.name, cfg.apiKey);
    throw new Error(`429 rate-limited on ${cfg.name}`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${cfg.name} HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }
  const data = JSON.parse(res.body);
  const text =
    data?.choices?.[0]?.message?.content ??
    data?.choices?.[0]?.text ??
    '';
  return {
    text: typeof text === 'string' ? text : JSON.stringify(text),
    provider: cfg.name,
    model: modelId,
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
    raw: data,
  };
}

/**
 * Gemini native generateContent call.
 * URL: POST {baseUrl}/models/{model}:generateContent?key={apiKey}
 */
export async function callGeminiNative(
  cfg: ProviderConfig,
  req: LlmCompletionRequest,
  modelId: string,
  temperature = 0.3,
): Promise<LlmCompletionResponse> {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(
    modelId,
  )}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  // Convert messages → Gemini contents. System prompt → system_instruction.
  let systemPrompt = '';
  const contents: any[] = [];
  for (const m of req.messages) {
    if (m.role === 'system') {
      systemPrompt += (systemPrompt ? '\n' : '') + m.content;
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }
  const body = JSON.stringify({
    contents,
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
    generationConfig: {
      temperature,
      ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
    },
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const res = await httpsRequest(url, { method: 'POST', headers, body });
  if (res.status === 429) {
    if (cfg.apiKey) markKeyRateLimited(cfg.name, cfg.apiKey);
    throw new Error(`429 rate-limited on ${cfg.name} (gemini)`);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${cfg.name} (gemini) HTTP ${res.status}: ${res.body.slice(0, 300)}`);
  }
  const data = JSON.parse(res.body);
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
  return {
    text,
    provider: cfg.name,
    model: modelId,
    usage: {
      promptTokens: data?.usageMetadata?.promptTokenCount,
      completionTokens: data?.usageMetadata?.candidatesTokenCount,
      totalTokens: data?.usageMetadata?.totalTokenCount,
    },
    raw: data,
  };
}

// ---------------------------------------------------------------------------
// Single-provider complete()
// ---------------------------------------------------------------------------

export async function complete(req: LlmCompletionRequest): Promise<LlmCompletionResponse> {
  // 1. Resolve provider from req.preferProvider OR module config.
  let providerName = req.preferProvider;
  let modelId = req.model;
  let temperature = req.temperature ?? 0.3;

  if (!providerName && req.moduleKey && req.layer) {
    const resolved = await resolveModel(req.moduleKey, req.layer);
    if (resolved) {
      providerName = resolved.provider.name;
      if (!modelId) modelId = resolved.modelId;
      temperature = req.temperature ?? resolved.temperature;
    }
  }

  if (!providerName) {
    throw new Error('LLM complete(): no provider specified (set preferProvider or moduleKey+layer)');
  }

  const cfg = await getProviderConfig(providerName);
  if (!cfg || !cfg.isActive) {
    throw new Error(`LLM provider "${providerName}" not found or inactive`);
  }
  if (!modelId) {
    throw new Error(`LLM complete(): no modelId resolved for provider ${providerName}`);
  }

  // 2. Dispatch to the right driver.
  if (providerName.toLowerCase() === 'gemini') {
    return callGeminiNative(cfg, req, modelId, temperature);
  }
  return callOpenAICompatible(cfg, req, modelId, temperature);
}

// ---------------------------------------------------------------------------
// Auto-fallback complete — reliability priority
// ---------------------------------------------------------------------------

const FALLBACK_PRIORITY = ['pollinations', 'groq', 'nvidia', 'mistral', 'openrouter', 'gemini'];

export async function completeWithAutoFallback(
  req: LlmCompletionRequest,
): Promise<LlmCompletionResponse> {
  const errors: string[] = [];

  // Build the ordered list of providers to try.
  const ordered: string[] = [];
  if (req.preferProvider) ordered.push(req.preferProvider);
  for (const p of FALLBACK_PRIORITY) {
    if (!ordered.includes(p)) ordered.push(p);
  }

  // Filter to active providers (DB lookup, cached for the call).
  const active = await getActiveProviders();
  const activeNames = new Set(active.map((p) => p.name));

  for (const name of ordered) {
    if (!activeNames.has(name)) continue;
    try {
      const cfg = await getProviderConfig(name);
      if (!cfg) continue;
      // Resolve model id for this provider.
      let modelId = req.model;
      if (!modelId && req.moduleKey && req.layer) {
        const resolved = await resolveModel(req.moduleKey, req.layer);
        if (resolved && resolved.provider.name === name) {
          modelId = resolved.modelId;
        }
      }
      // Per-provider default models (used when no module config).
      if (!modelId) {
        const defaults: Record<string, string> = {
          pollinations: 'openai',
          gemini: 'gemini-1.5-flash',
          groq: 'llama-3.1-8b-instant',
          nvidia: 'meta/llama-3.1-8b-instruct',
          mistral: 'mistral-small-latest',
          openrouter: 'openai/gpt-oss-20b:free',
        };
        modelId = defaults[name];
      }
      if (!modelId) continue;

      const temp = req.temperature ?? 0.3;
      if (name.toLowerCase() === 'gemini') {
        return await callGeminiNative(cfg, req, modelId, temp);
      }
      return await callOpenAICompatible(cfg, req, modelId, temp);
    } catch (err) {
      errors.push(`${name}: ${(err as Error).message}`);
      // Continue to next provider.
    }
  }

  throw new Error(
    `All LLM providers failed. Errors: ${errors.join(' | ')}`,
  );
}
