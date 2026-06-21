/**
 * OMNISCIENT Scheduler Mini-Service
 *
 * Always-on cron loop. Designed to run on Hugging Face Spaces (Docker, free tier)
 * with an external cron pinger (cron-job.org / UptimeRobot) to keep the Space alive.
 *
 * Every POLL_INTERVAL seconds it POSTs to the Next.js /api/scheduler/tick endpoint,
 * which checks which analysis modules are due and runs them.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 bun index.ts
 *   POLL_INTERVAL=60 bun index.ts
 *   TICKER_INTERVAL=15 bun index.ts   # forces a crypto scan every 15 min regardless of cron expr
 */

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60', 10); // seconds
const PORT = parseInt(process.env.PORT || '3042', 10); // tiny status server

const startedAt = Date.now();
let ticksTotal = 0;
let ticksOk = 0;
let ticksErr = 0;
let lastTickAt: string | null = null;
let lastTickResult: any = null;
let lastError: string | null = null;

async function tick() {
  ticksTotal++;
  try {
    const res = await fetch(`${APP_URL}/api/scheduler/tick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now() }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`tick HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
    const json = await res.json();
    ticksOk++;
    lastTickAt = new Date().toISOString();
    lastTickResult = json;
    lastError = null;
    const ran = json.data?.ran ?? [];
    if (ran.length > 0) {
      console.log(`[${lastTickAt}] tick OK — ran ${ran.length} module(s):`, JSON.stringify(ran.map((r: any) => r.module || r.symbol)));
    }
  } catch (e: any) {
    ticksErr++;
    lastError = e.message;
    lastTickAt = new Date().toISOString();
    console.error(`[${lastTickAt}] tick FAILED:`, e.message);
  }
}

// Tiny HTTP status server (for HF Spaces health check + cron ping keep-alive)
const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({
        status: 'alive',
        service: 'omniscient-scheduler',
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        appUrl: APP_URL,
        pollIntervalSec: POLL_INTERVAL,
        ticks: { total: ticksTotal, ok: ticksOk, err: ticksErr },
        lastTickAt,
        lastError,
        lastTickResult,
      }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/trigger') {
      await tick();
      return Response.json({ triggered: true, lastTickAt });
    }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`🟢 OMNISCIENT Scheduler running on port ${PORT}`);
console.log(`   App URL: ${APP_URL}`);
console.log(`   Poll interval: ${POLL_INTERVAL}s`);
console.log(`   Health: http://localhost:${PORT}/health`);
console.log(`   Trigger: POST http://localhost:${PORT}/trigger`);

// initial tick
tick();

// recurring loop
setInterval(tick, POLL_INTERVAL * 1000);

// keep process alive
process.on('SIGTERM', () => { server.stop(); process.exit(0); });
process.on('SIGINT', () => { server.stop(); process.exit(0); });
