/**
 * Telegram test API.
 *
 * POST /api/telegram/test
 *   Sends a test message via the configured Telegram bot. Reads
 *   `telegram.bot_token` + `telegram.chat_id` from the Setting KV. Returns
 *   { ok, sent } on success.
 */
import { NextResponse } from 'next/server';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

const TELEGRAM_API = 'https://api.telegram.org';

export async function POST() {
  try {
    const token = await getSetting<string>(SETTING_KEYS.telegramBotToken);
    const chatId = await getSetting<string>(SETTING_KEYS.telegramChatId);
    if (!token || !chatId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Telegram bot token or chat ID not configured. Set them in Settings → Alerts.',
        },
        { status: 400 },
      );
    }

    const text = `🧪 *OMNISCIENT test*\nDelivery check OK at ${new Date().toISOString()}.`;
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return NextResponse.json(
        { success: false, error: `Telegram HTTP ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, data: { sent: true, chatId } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
