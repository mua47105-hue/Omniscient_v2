// Health check endpoint — public (no auth required).
// Used by HF Spaces health checks and the scheduler to verify the app is alive.
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime ? Math.floor(process.uptime()) : null,
  });
}
