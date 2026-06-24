// LLM router helpers — shared utilities that can be imported without causing
// circular dependencies. The sanitizeApiKey function is used by both the
// router (llm/router.ts) and the test endpoint (api/llm/test/route.ts).

/**
 * Sanitize an API key for safe use in HTTP headers.
 * Strips ALL non-ASCII characters, control characters, quotes, and whitespace
 * that would cause "Invalid character in header content" errors.
 * Only keeps ASCII printable characters (0x20-0x7E) except spaces.
 */
export function sanitizeApiKey(key: string): string {
  if (!key || typeof key !== 'string') return '';
  return key
    // Remove ALL non-ASCII characters (Unicode whitespace, BOM, zero-width chars, etc.)
    .replace(/[^\x20-\x7E]/g, '')
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Strip surrounding quotes
    .replace(/^["'`]+|["'`]+$/g, '')
    // Remove any remaining spaces (API keys never contain spaces)
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Split a provider's apiKey field into individual keys (newline-separated).
 * Each key is sanitized to remove invalid header characters.
 */
export function parseKeys(apiKey: string): string[] {
  if (!apiKey || typeof apiKey !== 'string') return [];
  return apiKey
    .split('\n')
    .map((k) => sanitizeApiKey(k))
    .filter((k) => k.length > 0 && !k.startsWith('PASTE_') && !k.startsWith('YOUR_'));
}
