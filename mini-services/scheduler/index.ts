const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '60', 10);
const PORT = 3042;
const startedAt = Date.now();
let ticksTotal = 0, ticksOk = 0, ticksErr = 0;
let lastTickAt = null, lastError = null;

async function tick() {
  ticksTotal++;
  try {
    const res = await fetch(`${APP_URL}/api/scheduler/tick`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ts: Date.now() }), signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`tick HTTP ${res.status}`);
    ticksOk++; lastTickAt = new Date().toISOString(); lastError = null;
  } catch (e) {
    ticksErr++; lastError = e.message; lastTickAt = new Date().toISOString();
    console.error(`[${lastTickAt}] tick FAILED:`, e.message);
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health' || url.pathname === '/') {
      return Response.json({ status: 'alive', service: 'omniscient-scheduler', uptimeSec: Math.floor((Date.now() - startedAt) / 1000), appUrl: APP_URL, pollIntervalSec: POLL_INTERVAL, ticks: { total: ticksTotal, ok: ticksOk, err: ticksErr }, lastTickAt, lastError }, { headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.pathname === '/trigger') { await tick(); return Response.json({ triggered: true, lastTickAt }); }
    return new Response('Not Found', { status: 404 });
  },
});

console.log(`🟢 OMNISCIENT Scheduler running on port ${PORT}`);
tick();
setInterval(tick, POLL_INTERVAL * 1000);
process.on('SIGTERM', () => { server.stop(); process.exit(0); });
process.on('SIGINT', () => { server.stop(); process.exit(0); });
