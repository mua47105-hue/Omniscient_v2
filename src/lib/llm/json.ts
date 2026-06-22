// Robust JSON extraction from LLM responses.
//
// WHY THIS EXISTS:
// LLMs (especially Pollinations/gpt-oss, but also Mistral, OpenRouter free
// models, etc.) frequently return "JSON" that isn't directly parseable:
//   1. Markdown code fences:  ```json\n{...}\n```
//   2. Preamble prose:        "Here is the JSON you requested:\n{...}"
//   3. Trailing commentary:   "{...}\n\nLet me know if you need more detail."
//   4. Multiple JSON blocks:  only the FIRST balanced one is what we want.
//   5. Empty content + answer buried in a `reasoning` field (Pollinations quirk).
//
// Calling JSON.parse(result.content) directly crashes on all of these.
// This module finds the first balanced {...} or [...] block and parses it,
// returning null on failure so callers can fall back to deterministic defaults
// instead of dropping the entire LLM layer.

/**
 * Strip markdown code fences and common preamble patterns from an LLM response.
 * Handles ```json, ``` (bare), and ```language fences.
 */
function stripFencesAndPreamble(content: string): string {
  let s = content.trim();

  // Strip code fences: ```json ... ``` or ``` ... ```
  // (non-greedy, handles fences that span the whole response)
  s = s.replace(/```(?:json|JSON|[a-z]*)\s*\n?/g, '');
  s = s.replace(/```/g, '');

  // Strip common preamble lines before the first { or [
  // e.g. "Here is the JSON:", "Sure, here's the response:", "```json"
  const firstBrace = s.search(/[{[]/);
  if (firstBrace > 0) {
    const preamble = s.slice(0, firstBrace).toLowerCase();
    // Only strip if the preamble looks like filler, not data
    if (/^(here|sure|below|the|this|sure,|certainly|of course|response|json|output|result)/i.test(preamble.trim())) {
      s = s.slice(firstBrace);
    }
  }

  return s.trim();
}

/**
 * Find the first balanced JSON block (object {...} or array [...]) in a string.
 * Handles nested braces/brackets and strings containing escaped quotes.
 * Returns the raw substring, or null if no balanced block is found.
 */
function findFirstJsonBlock(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const c = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null; // unbalanced — no complete block
}

/**
 * Extract the first JSON object ({...}) from an LLM content string.
 * Returns the parsed object, or null if no valid JSON object is found.
 *
 * Handles: markdown fences, preamble prose, trailing commentary, nested objects.
 */
export function extractJsonObject<T = Record<string, unknown>>(content: string): T | null {
  if (!content || typeof content !== 'string') return null;

  const cleaned = stripFencesAndPreamble(content);

  // Fast path: the whole thing is already valid JSON
  try {
    const v = JSON.parse(cleaned);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as T;
  } catch {
    /* fall through to balanced extraction */
  }

  // Slow path: find the first balanced {...} block
  const block = findFirstJsonBlock(cleaned);
  if (!block) return null;

  try {
    const v = JSON.parse(block);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as T;
  } catch {
    // Last resort: try to fix common issues (trailing commas, smart quotes)
    try {
      const fixed = block
        .replace(/,\s*([}\]])/g, '$1') // trailing commas before } or ]
        .replace(/[\u201c\u201d]/g, '"') // smart double quotes
        .replace(/[\u2018\u2019]/g, "'"); // smart single quotes
      const v = JSON.parse(fixed);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as T;
    } catch {
      /* give up */
    }
  }
  return null;
}

/**
 * Extract the first JSON array ([...]) from an LLM content string.
 * Returns the parsed array, or null if no valid JSON array is found.
 */
export function extractJsonArray<T = unknown>(content: string): T[] | null {
  if (!content || typeof content !== 'string') return null;

  const cleaned = stripFencesAndPreamble(content);

  try {
    const v = JSON.parse(cleaned);
    if (Array.isArray(v)) return v as T[];
  } catch {
    /* fall through */
  }

  const block = findFirstJsonBlock(cleaned);
  if (!block || !block.startsWith('[')) return null;

  try {
    const v = JSON.parse(block);
    if (Array.isArray(v)) return v as T[];
  } catch {
    try {
      const fixed = block
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      const v = JSON.parse(fixed);
      if (Array.isArray(v)) return v as T[];
    } catch {
      /* give up */
    }
  }
  return null;
}

/**
 * Extract ANY JSON value (object, array, string, number, boolean) from content.
 * Generic escape hatch for callers that don't know the shape ahead of time.
 */
export function extractJson<T = unknown>(content: string): T | null {
  if (!content || typeof content !== 'string') return null;

  const cleaned = stripFencesAndPreamble(content);

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    /* fall through */
  }

  const block = findFirstJsonBlock(cleaned);
  if (!block) return null;

  try {
    return JSON.parse(block) as T;
  } catch {
    try {
      const fixed = block
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}
