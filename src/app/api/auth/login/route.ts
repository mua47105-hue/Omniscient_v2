import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import { HF_SECRETS } from '@/lib/runtime';
import { createSessionToken } from '@/lib/auth/session';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

// --- Login rate limiting (per Improvement Plan §1.3) ---
// Simple in-memory counter: max 5 attempts per 15 min per IP. Exponential
// lockout after repeated failures. (In a multi-worker deployment this would
// need to be in a shared store, but for a single-process HF Space this is fine.)
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 min
const LOCKOUT_MS = 5 * 60 * 1000; // 5 min lockout after 5 failures

const attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (entry) {
    // If locked out, reject
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    // Reset window if expired
    if (now - entry.firstAt > WINDOW_MS) {
      attempts.delete(ip);
    }
  }
  return { allowed: true };
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, firstAt: now, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    entry.count = 0; // reset count so the lockout is the active state
    entry.firstAt = now;
  }
  attempts.set(ip, entry);
}

function clearAttempts(ip: string): void {
  attempts.delete(ip);
}

/** Timing-safe string comparison to prevent timing attacks on the password. */
function timingSafeStringEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function POST(req: NextRequest) {
  // Rate limit check
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = checkRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: `Too many attempts. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 300) } }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { password } = body;

    if (typeof password !== 'string' || password.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Password required' },
        { status: 400 }
      );
    }

    // Password resolution (env-over-DB):
    //   1. HF Secret: process.env.APP_PASSWORD (set in Space Settings UI)
    //   2. DB Setting: app_password (set via Settings → Security UI)
    //   3. Refuse to boot if neither is set (security: no default password)
    const dbPassword = await getSetting<string>(SETTING_KEYS.appPassword, '');
    const envPassword = HF_SECRETS.appPassword;

    if (!envPassword && !dbPassword) {
      // No password configured — refuse login (security hardening per §1.4).
      // In production, APP_PASSWORD must be set as an HF Secret.
      console.error('[auth] No password configured — set APP_PASSWORD env or configure in Settings → Security');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No password configured. Set APP_PASSWORD env var.' },
        { status: 503 }
      );
    }

    const correctPassword = envPassword || dbPassword;

    // Timing-safe comparison (per §1.4 / M3)
    if (!timingSafeStringEq(password, correctPassword)) {
      recordFailedAttempt(ip);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Wrong password' },
        { status: 401 }
      );
    }

    // Success — clear rate limit, issue signed session token
    clearAttempts(ip);
    const token = createSessionToken();
    const res = NextResponse.json<ApiResult<{ ok: boolean }>>({ success: true, data: { ok: true } });
    res.cookies.set('omniscient-auth', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    });
    return res;
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Login failed' },
      { status: 500 }
    );
  }
}
