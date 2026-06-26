// Telegram webhook endpoint — receives messages FROM Telegram.
//
// When a user sends a message to the bot, Telegram pushes it to this endpoint
// (inbound — Telegram calls US, not the other way around). This works even
// when outbound to api.telegram.org is blocked, because Telegram initiates
// the connection.
//
// We respond to the webhook with a Bot API method call in the response body.
// Telegram then executes that method (e.g., sendMessage) on its end and
// delivers the reply to the user. This is the "webhook reply" pattern:
// https://core.telegram.org/bots/api#making-requests-when-getting-updates
//
// Supported commands:
//   /start — welcome message
//   /status — current brain status + recent signals
//   /alerts — pending alerts that couldn't be pushed (queued)
//   /help — list of commands

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    // Only handle messages
    if (!update.message || !update.message.text) {
      return NextResponse.json({ ok: true });
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const command = text.toLowerCase().split(' ')[0];

    let replyText = '';
    let parseMode: string | undefined;

    if (command === '/start') {
      replyText = '🤖 *OMNISCIENT Bot connected!*\n\nI will send you trading signals here.\n\nCommands:\n/status — Brain status\n/alerts — Pending alerts\n/help — Help';
      parseMode = 'Markdown';
    } else if (command === '/status') {
      // Get brain state
      const brainState = await getSetting<any>(SETTING_KEYS.brainState, {});
      const running = brainState.running !== false;
      const lastTick = await getSetting<string>(SETTING_KEYS.lastSchedulerTick, 'never');

      // Get recent signals
      const recentSignals = await db.signal.findMany({
        take: 3,
        orderBy: { timestamp: 'desc' },
        include: { asset: true },
      });

      let signalText = recentSignals.length > 0
        ? recentSignals.map(s => `  ${s.asset.symbol} ${s.direction.toUpperCase()} ${s.conviction}%`).join('\n')
        : '  No signals yet';

      replyText = `🧠 *Brain Status*\nRunning: ${running ? '✅ Yes' : '❌ Paused'}\nLast tick: ${lastTick}\n\n📊 *Recent Signals:*\n${signalText}`;
      parseMode = 'Markdown';
    } else if (command === '/alerts') {
      // Get failed alerts (ones that couldn't be pushed)
      const failedAlerts = await db.alert.findMany({
        where: { status: 'failed', channel: 'telegram' },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      if (failedAlerts.length === 0) {
        replyText = '✅ No pending alerts. All signals have been delivered.';
      } else {
        replyText = `📬 ${failedAlerts.length} pending alert(s):\n`;
        for (const a of failedAlerts) {
          const payload = JSON.parse(a.payload || '{}');
          replyText += `\n${payload.asset || '?'} ${payload.direction || '?'} ${payload.conviction || '?'}%\n`;
        }
      }
    } else if (command === '/help') {
      replyText = '🤖 *OMNISCIENT Bot Commands:*\n\n/start — Welcome\n/status — Brain status + recent signals\n/alerts — Pending alerts\n/help — This message';
      parseMode = 'Markdown';
    } else {
      replyText = `Unknown command. Send /help for available commands.`;
    }

    // Respond with a sendMessage method call — Telegram delivers it to the user
    return NextResponse.json({
      method: 'sendMessage',
      chat_id: chatId,
      text: replyText,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
  } catch (e: any) {
    console.error('[telegram/webhook] Error:', e.message);
    return NextResponse.json({ ok: true }); // Always return 200 so Telegram doesn't retry
  }
}
