// Telegram Bot alert dispatcher — sends trade-signal alerts.
// Requires a bot token (from @BotFather) + chat id.

import { db } from '@/lib/db';
import { getSetting } from '@/lib/config/settings';
import type { ConsensusResult } from '@/lib/types';

async function getTelegramConfig() {
  // IMPORTANT: use getSetting() which JSON-parses the stored value.
  // Reading db.setting.findUnique().value directly returns the raw JSON-stringified
  // value (e.g. '"abc123"' with quotes), which breaks Telegram API calls (404).
  const token = await getSetting<string>('telegram_bot_token', '');
  const chatId = await getSetting<string>('telegram_chat_id', '');
  return { token, chatId };
}

function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function formatSignal(signal: ConsensusResult): string {
  const dirEmoji = signal.direction === 'long' ? '🟢' : signal.direction === 'short' ? '🔴' : '⚪';
  const convBar = '█'.repeat(Math.round(signal.conviction / 10)) + '░'.repeat(10 - Math.round(signal.conviction / 10));
  const lines: string[] = [];
  lines.push(`${dirEmoji} *SIGNAL: ${signal.asset}*`);
  lines.push(`Direction: *${signal.direction.toUpperCase()}*`);
  lines.push(`Conviction: \`${convBar}\` ${signal.conviction}%`);
  lines.push(`Timeframe: ${signal.timeframe}`);
  if (signal.entryPrice) lines.push(`Entry: \`${signal.entryPrice}\``);
  if (signal.stopLoss) lines.push(`Stop: \`${signal.stopLoss}\``);
  if (signal.takeProfit) lines.push(`Target: \`${signal.takeProfit}\``);
  lines.push('');
  lines.push('*Analysis Layers:*');
  for (const l of signal.layers) {
    const emoji = l.score > 20 ? '🟢' : l.score < -20 ? '🔴' : '⚪';
    lines.push(`${emoji} ${l.layer}: ${l.score > 0 ? '+' : ''}${l.score} (${l.confidence}%)`);
  }
  lines.push('');
  lines.push(`*Models:* ${signal.modelsUsed.join(', ')}`);
  lines.push('');
  lines.push(`*Rationale:*`);
  // Escape rationale for MarkdownV2 — it contains | _ . % [ ] etc. that break Telegram parsing
  lines.push(escapeMd(signal.rationale.slice(0, 800)));
  return lines.join('\n');
}

export async function sendTelegramMessage(text: string, parseMode: 'MarkdownV2' | 'HTML' = 'MarkdownV2') {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) throw new Error('Telegram bot token or chat id not configured');
  // Sanitize token — strip quotes, whitespace, and non-ASCII chars that cause "fetch failed"
  const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!safeToken) throw new Error('Telegram bot token is empty after sanitization');
  if (!safeChatId) throw new Error('Telegram chat ID is empty after sanitization');

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    res = await fetch(`https://api.telegram.org/bot${safeToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: safeChatId, text, parse_mode: parseMode }),
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (fetchErr: any) {
    // "fetch failed" = network-level failure (DNS, connection refused, timeout, geo-block)
    // Provide a clear, actionable error instead of the raw Node.js TypeError
    if (fetchErr.name === 'AbortError') {
      throw new Error('Telegram API request timed out (15s). api.telegram.org may be blocked from this server.');
    }
    throw new Error(`Cannot reach api.telegram.org — network error: ${fetchErr.message || fetchErr.cause?.message || 'unknown'}. The server may be geo-blocked or api.telegram.org may be unreachable.`);
  }

  if (!res.ok) {
    const errBody = await res.text();
    // Provide actionable error messages for common Telegram failures
    let hint = '';
    if (res.status === 401) {
      hint = ' — bot token is invalid or revoked. Get a fresh token from @BotFather.';
    } else if (res.status === 404) {
      hint = ' — bot token not found. Check for extra quotes/spaces in the token, or create a new bot via @BotFather.';
    } else if (res.status === 400 && errBody.includes('chat not found')) {
      hint = ' — the bot cannot find this chat. Open Telegram, search for your bot, and send /start to it first. (Bots can only message users who have started a conversation with them.)';
    } else if (res.status === 400 && errBody.includes('chat_id is empty')) {
      hint = ' — chat ID is empty. Get your chat ID from @userinfobot or @RawDataBot.';
    } else if (res.status === 400 && errBody.includes("can't parse")) {
      hint = ' — message formatting error (MarkdownV2). The test message will be retried as plain text.';
    } else if (res.status === 429) {
      hint = ' — rate limited by Telegram. Wait a moment and try again.';
    }
    throw new Error(`Telegram ${res.status}: ${errBody}${hint}`);
  }
  return res.json();
}

export async function sendSignalAlert(signal: ConsensusResult) {
  try {
    await sendTelegramMessage(formatSignal(signal));
    await db.alert.create({
      data: {
        channel: 'telegram',
        status: 'sent',
        sentAt: new Date(),
        payload: JSON.stringify(signal),
      },
    });
    return true;
  } catch (e: any) {
    await db.alert.create({
      data: {
        channel: 'telegram',
        status: 'failed',
        error: e.message,
        payload: JSON.stringify(signal),
      },
    });
    return false;
  }
}

export async function sendTestMessage(): Promise<boolean> {
  const text = '✅ OMNISCIENT Telegram channel connected. You will receive trade signals here.';
  try {
    // Try plain text first (most reliable for test messages)
    await sendTelegramMessage(text, 'HTML');
  } catch (e: any) {
    // If it's a formatting error, retry without parse_mode by sending raw
    if (e.message.includes("can't parse") || e.message.includes('parse')) {
      // Reuse sendTelegramMessage with no parse mode by calling the API directly
      // but wrapped in the same error handling
      const { token, chatId } = await getTelegramConfig();
      const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      let res: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        res = await fetch(`https://api.telegram.org/bot${safeToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: safeChatId, text }),
          signal: controller.signal,
        });
        clearTimeout(timer);
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') {
          throw new Error('Telegram API request timed out (15s). api.telegram.org may be blocked from this server.');
        }
        throw new Error(`Cannot reach api.telegram.org — network error: ${fetchErr.message || fetchErr.cause?.message || 'unknown'}.`);
      }
      if (!res.ok) {
        const errBody = await res.text();
        let hint = '';
        if (res.status === 400 && errBody.includes('chat not found')) {
          hint = ' — Open Telegram, search for your bot, and send /start to it first.';
        } else if (res.status === 404) {
          hint = ' — Check the bot token for extra quotes/spaces.';
        }
        throw new Error(`Telegram ${res.status}: ${errBody}${hint}`);
      }
    } else {
      throw e;
    }
  }
  return true;
}
