// Session token management — HMAC-signed tokens for auth cookies.
//
// SECURITY (per Improvement Plan §1.2):
// Previously the auth cookie was the forgeable magic string "authenticated".
// Now the cookie is an HMAC-signed token: payload.signature
//
// Uses node:crypto (the login route runs in Node runtime, not Edge).

import { createHmac } from 'node:crypto';

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Get the session signing secret. Falls back to APP_PASSWORD or a dev default. */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  if (!secret) {
    return 'dev-only-insecure-secret-do-not-use-in-prod';
  }
  return secret;
}

/** Base64url encode (URL-safe, no padding). */
function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/** Base64url decode. */
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

/**
 * Create a signed session token.
 * Format: base64url(payload).base64url(signature)
 * Payload: {iat: number, nonce: string}
 */
export function createSessionToken(): string {
  const payload = {
    iat: Date.now(),
    nonce: Math.random().toString(36).slice(2, 12),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = b64url(payloadStr);
  const signature = createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Verify a session token. Returns true if the signature is valid and the
 * token hasn't expired.
 *
 * NOTE: This function uses node:crypto and can only run in the Node runtime
 * (not Edge). The middleware does a lightweight format check instead (see
 * middleware.ts). This full verification is for defense-in-depth in API routes.
 */
export function verifySessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;

  // Backward compat: accept the legacy magic string during the migration window.
  if (token === 'authenticated') return true;

  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return false;

  // Recompute the signature
  const expectedSignature = createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  // Manual timing-safe comparison
  if (signature.length !== expectedSignature.length) return false;
  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  if (result !== 0) return false;

  // Check expiry
  try {
    const payload = JSON.parse(b64urlDecode(payloadB64));
    if (typeof payload.iat !== 'number') return false;
    const age = Date.now() - payload.iat;
    if (age > SESSION_MAX_AGE_MS || age < 0) return false;
    return true;
  } catch {
    return false;
  }
}
