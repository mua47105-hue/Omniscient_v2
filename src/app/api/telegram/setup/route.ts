// Telegram webhook setup endpoint — registers the webhook with Telegram.
//
// After deploying, visit this endpoint to register your webhook:
//   GET /api/telegram/setup
//
// This tells Telegram to send incoming messages to:
//   https://<your-space>.hf.space/api/telegram/webhook
//
// Once registered, users can send commands (/status, /alerts, /help) to
// your bot and receive replies — even if outbound to api.telegram.org is
// blocked from the Space.

import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import { getSetting } from '@/lib/config/settings';
import type { ApiResult } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TELEGRAM_IPS = ['149.154.167.220', '149.154.166.110'];

function telegramGet(path: string, timeoutMs = 15000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function tryNext() {
      if (attempts >= TELEGRAM_IPS.length) { reject(new Error('All IPs failed')); return; }
      const ip = TELEGRAM_IPS[attempts++];
      const req = https.request({
        hostname: ip, port: 443, path, method: 'GET',
        headers: { 'Host': 'api.telegram.org' },
        servername: 'api.telegram.org',
        timeout: timeoutMs, family: 4,
        agent: new https.Agent({ family: 4, rejectUnauthorized: true }),
      }, (res) => {
        let data = ''; res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
      });
      req.on('error', () => tryNext());
      req.on('timeout', () => { req.destroy(); tryNext(); });
      req.end();
    }
    tryNext();
  });
}

export async function GET(req: NextRequest) {
  try {
    const token = await getSetting<string>('telegram_bot_token', '');
    if (!token || token.startsWith('PASTE_')) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Telegram bot token not configured. Set it in Settings → Alerts.' },
        { status: 400 }
      );
    }

    const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();

    // Determine the webhook URL from the request host
    const host = req.headers.get('host') || '';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;

    // Register webhook with Telegram
    const path = `/bot${safeToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    const { status, text } = await telegramGet(path);

    if (status === 200) {
      const result = JSON.parse(text);
      if (result.ok) {
        return NextResponse.json<ApiResult<{ webhookUrl: string; result: any }>>({
          success: true,
          data: { webhookUrl, result },
        });
      }
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Telegram rejected webhook: ${result.description}` },
        { status: 400 }
      );
    }

    return NextResponse.json<ApiResult<never>>(
      { success: false, error: `Telegram API returned ${status}: ${text.slice(0, 200)}` },
      { status: 502 }
    );
  } catch (e: any) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: `Cannot reach Telegram API: ${e.message}. Try visiting this URL in your browser: https://api.telegram.org/bot<TOKEN>/setWebhook?url=<YOUR_SPACE_URL>/api/telegram/webhook` },
      { status: 502 }
    );
  }
}
