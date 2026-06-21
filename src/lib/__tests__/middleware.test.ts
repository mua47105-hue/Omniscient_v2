// Middleware auth tests — verify that API routes (except /api/auth/*) require auth.
// Uses Bun's built-in fetch to test against the running dev server.

import { describe, test, expect } from 'bun:test';

const BASE = 'http://localhost:3000';

describe('middleware auth gating', () => {
  test('unauthenticated GET /api/llm/providers → 307 redirect to /lock', async () => {
    const res = await fetch(`${BASE}/api/llm/providers`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/lock');
  });

  test('unauthenticated GET /api/brain → 307 redirect to /lock', async () => {
    const res = await fetch(`${BASE}/api/brain`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/lock');
  });

  test('unauthenticated POST /api/brain (forceRun) → 307 redirect to /lock', async () => {
    const res = await fetch(`${BASE}/api/brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'forceRun', symbol: 'BTCUSDT' }),
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
  });

  test('/api/auth/login is publicly accessible (not redirected)', async () => {
    // POST to /api/auth/login without auth cookie should NOT be redirected.
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
      redirect: 'manual',
    });
    // Should get 401 (wrong password) not 307 (redirect).
    expect(res.status).not.toBe(307);
  });

  test('unauthenticated GET / → 307 redirect to /lock', async () => {
    const res = await fetch(`${BASE}/`, { redirect: 'manual' });
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/lock');
  });

  test('/lock is publicly accessible', async () => {
    const res = await fetch(`${BASE}/lock`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });
});
