// Telegram Bot alert dispatcher — sends trade-signal alerts.
// Requires a bot token (from @BotFather) + chat id.
//
// IMPORTANT: Uses node:https instead of fetch() to bypass Next.js fetch
// patching, which causes "fetch failed" on Hugging Face Spaces (the patched
// fetch can't reach api.telegram.org from datacenter IPs).

import https from 'node:https';
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

/**
 * Make an HTTPS POST request using node:https (bypasses Next.js fetch patching
 * that causes "fetch failed" on Hugging Face Spaces).
 */
function telegramPost(url: string, body: any, timeoutMs = 15_000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
      }
    );
    req.on('error', (e) => {
      // Distinguish timeout from other network errors
      if (e.message === 'timeout' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
        reject(new Error('timeout'));
      } else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
        reject(new Error('DNS resolution failed for api.telegram.org — the server cannot resolve the hostname'));
      } else if (e.code === 'ECONNREFUSED') {
        reject(new Error('Connection refused by api.telegram.org — the service may be blocked from this IP'));
      } else {
        reject(new Error(`network error: ${e.message} (code: ${e.code || 'unknown'})`));
      }
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(bodyStr);
    req.end();
  });
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
  // Sanitize token — strip quotes, whitespace, and non-ASCII chars
  const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!safeToken) throw new Error('Telegram bot token is empty after sanitization');
  if (!safeChatId) throw new Error('Telegram chat ID is empty after sanitization');

  let result: { status: number; text: string };
  try {
    result = await telegramPost(
      `https://api.telegram.org/bot${safeToken}/sendMessage`,
      { chat_id: safeChatId, text, parse_mode: parseMode }
    );
  } catch (err: any) {
    if (err.message === 'timeout') {
      throw new Error('Telegram API request timed out (15s). api.telegram.org may be blocked from this server.');
    }
    throw new Error(`Cannot reach api.telegram.org — ${err.message || 'network error'}.`);
  }

  if (result.status < 200 || result.status >= 300) {
    const errBody = result.text;
    let hint = '';
    if (result.status === 401) {
      hint = ' — bot token is invalid or revoked. Get a fresh token from @BotFather.';
    } else if (result.status === 404) {
      hint = ' — bot token not found. Check for extra quotes/spaces, or create a new bot via @BotFather.';
    } else if (result.status === 400 && errBody.includes('chat not found')) {
      hint = ' — Open Telegram, search for your bot, and send /start to it first.';
    } else if (result.status === 400 && errBody.includes('chat_id is empty')) {
      hint = ' — chat ID is empty. Get your chat ID from @userinfobot or @RawDataBot.';
    } else if (result.status === 400 && errBody.includes("can't parse")) {
      hint = ' — message formatting error. Will retry as plain text.';
    } else if (result.status === 429) {
      hint = ' — rate limited by Telegram. Wait a moment and try again.';
    }
    throw new Error(`Telegram ${result.status}: ${errBody}${hint}`);
  }
  return JSON.parse(result.text);
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
    await sendTelegramMessage(text, 'HTML');
  } catch (e: any) {
    if (e.message.includes("can't parse") || e.message.includes('parse')) {
      // Retry as plain text (no parse_mode)
      const { token, chatId } = await getTelegramConfig();
      const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      try {
        const result = await telegramPost(
          `https://api.telegram.org/bot${safeToken}/sendMessage`,
          { chat_id: safeChatId, text }
        );
        if (result.status < 200 || result.status >= 300) {
          const errBody = result.text;
          let hint = '';
          if (result.status === 400 && errBody.includes('chat not found')) {
            hint = ' — Open Telegram, search for your bot, and send /start to it first.';
          } else if (result.status === 404) {
            hint = ' — Check the bot token for extra quotes/spaces.';
          }
          throw new Error(`Telegram ${result.status}: ${errBody}${hint}`);
        }
      } catch (err: any) {
        if (err.message === 'timeout') {
          throw new Error('Telegram API request timed out (15s). api.telegram.org may be blocked from this server.');
        }
        throw err;
      }
    } else {
      throw e;
    }
  }
  return true;
}
