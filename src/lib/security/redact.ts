// Secret redaction helpers — prevent plaintext API keys from leaking via GET endpoints.
//
// SECURITY (per Improvement Plan §2.1):
// Previously, /api/llm/providers, /api/llm/models, /api/llm/module-configs,
// and /api/settings all returned secrets in plaintext. Now all 4 endpoints
// redact sensitive fields before sending the response.
//
// Redaction rules:
//   - Placeholder values (PASTE_*, YOUR_*) are shown as-is (they're not real keys)
//   - Real keys are masked to "first4…last4" (e.g. "sk-o…abcd")
//   - Empty/null values stay empty
//   - The full key is never sent to the client

/** Mask a secret string to "first4…last4" format. Preserves placeholders + empty. */
export function redactSecret(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  // Show placeholders as-is (they indicate "not configured")
  if (trimmed.startsWith('PASTE_') || trimmed.startsWith('YOUR_')) return trimmed;
  // For multi-line keys (rotation), redact each line
  if (trimmed.includes('\n')) {
    return trimmed.split('\n').map(redactSecret).join('\n');
  }
  // Short values (<8 chars) — mask everything except the last 2
  if (trimmed.length < 8) {
    return '•'.repeat(trimmed.length - 2) + trimmed.slice(-2);
  }
  // Standard: first 4 + "…" + last 4
  return trimmed.slice(0, 4) + '…' + trimmed.slice(-4);
}

/** Redact apiKey in an LlmProvider object (and its nested models). */
export function redactProvider<T extends { apiKey: string; models?: any[] }>(provider: T): T {
  return {
    ...provider,
    apiKey: redactSecret(provider.apiKey),
    models: provider.models?.map(redactModel),
  };
}

/** Redact apiKey in an LlmModel object. */
export function redactModel<T extends { apiKey?: string }>(model: T): T {
  if (!model.apiKey) return model;
  return { ...model, apiKey: redactSecret(model.apiKey) };
}

/**
 * Redact sensitive settings in a settings object.
 * Sensitive keys: anything ending in _api_key, _token, _anon_key, _password, _secret.
 */
export function redactSettings(settings: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(settings)) {
    const lowerKey = key.toLowerCase();
    if (isSensitiveKey(lowerKey)) {
      out[key] = redactSecret(String(value ?? ''));
    } else {
      out[key] = value;
    }
  }
  return out;
}

function isSensitiveKey(lowerKey: string): boolean {
  return (
    lowerKey.endsWith('_api_key') ||
    lowerKey.endsWith('_token') ||
    lowerKey.endsWith('_anon_key') ||
    lowerKey.endsWith('_password') ||
    lowerKey.endsWith('_secret') ||
    lowerKey === 'telegram_bot_token' ||
    lowerKey === 'telegram_chat_id' ||
    lowerKey === 'supabase_anon_key' ||
    lowerKey === 'app_password' ||
    lowerKey === 'session_secret' ||
    lowerKey === 'cron_secret'
  );
}

/**
 * Safe error handler — returns a generic error message to the client while
 * logging the real error server-side. Prevents internal error details from
 * leaking. (Per Improvement Plan §3.5)
 */
export function safeError(e: unknown, context?: string): { status: number; error: string } {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[safeError${context ? ` ${context}` : ''}]:`, msg);

  if (msg.includes('Unique constraint')) {
    return { status: 409, error: 'A record with this value already exists' };
  }
  if (msg.includes('Record to update not found') || msg.includes('Record to delete not found')) {
    return { status: 404, error: 'Record not found' };
  }
  if (msg.includes('Foreign key constraint')) {
    return { status: 409, error: 'Cannot delete — other records depend on this' };
  }
  if (msg.includes('connect ECONNREFUSED') || msg.includes('fetch failed')) {
    return { status: 502, error: 'Upstream service unavailable' };
  }
  if (msg.includes('timeout') || msg.includes('Timeout')) {
    return { status: 504, error: 'Request timed out' };
  }

  return { status: 500, error: 'Internal error' };
}
