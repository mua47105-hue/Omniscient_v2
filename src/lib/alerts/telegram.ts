// Telegram Bot alert dispatcher — sends trade-signal alerts.
// Requires a bot token (from @BotFather) + chat id.
//
// IMPORTANT: Uses node:https with direct IP connection to bypass DNS issues
// on Hugging Face Spaces. Telegram's API has multiple IPs — we try each one
// in order. The Host header is set to api.telegram.org so TLS SNI works.

import https from 'node:https';
import dns from 'node:dns';
import { db } from '@/lib/db';
import { getSetting } from '@/lib/config/settings';
import type { ConsensusResult } from '@/lib/types';

async function getTelegramConfig() {
  const token = await getSetting<string>('telegram_bot_token', '');
  const chatId = await getSetting<string>('telegram_chat_id', '');
  return { token, chatId };
}

function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// Telegram API server IPs (official, from https://core.telegram.org/getting-started/virtual-hosts)
// We try each one in order, bypassing DNS resolution entirely.
const TELEGRAM_IPS = [
  '149.154.167.220',
  '149.154.166.110',
  '149.154.175.50',
];

/**
 * Make an HTTPS POST request to the Telegram API.
 * Tries multiple Telegram server IPs directly (bypassing DNS) with proper
 * SNI/Host headers. This is the most reliable way to reach api.telegram.org
 * from environments where DNS may fail (HF Spaces, some datacenters).
 */
function telegramPost(path: string, body: any, timeoutMs = 60_000): Promise<{ status: number; text: string }> {
  const bodyStr = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    let attempts = 0;
    let lastError: Error | null = null;

    function tryNextIp() {
      if (attempts >= TELEGRAM_IPS.length) {
        reject(lastError || new Error('All Telegram IPs failed'));
        return;
      }

      const ip = TELEGRAM_IPS[attempts];
      attempts++;

      const agent = new https.Agent({
        keepAlive: false,
        family: 4,
        rejectUnauthorized: true,
      });

      const req = https.request(
        {
          hostname: ip,           // Connect to the IP directly
          port: 443,
          path: path,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'Host': 'api.telegram.org',  // Required for TLS SNI + HTTP virtual hosting
          },
          timeout: timeoutMs,
          agent,
          servername: 'api.telegram.org', // TLS SNI — critical for certificate validation
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
        }
      );

      req.on('error', (e) => {
        console.log(`[telegram] IP ${ip} failed: ${e.code || e.message}`);
        lastError = e;
        // Try the next IP
        tryNextIp();
      });

      req.on('timeout', () => {
        console.log(`[telegram] IP ${ip} timed out`);
        req.destroy(new Error('timeout'));
        // The error handler will call tryNextIp
      });

      req.write(bodyStr);
      req.end();
    }

    tryNextIp();
  });
}

/**
 * Try to send a Telegram message with retry.
 * If the first attempt times out, retry once with a shorter timeout.
 */
async function telegramPostWithRetry(path: string, body: any): Promise<{ status: number; text: string }> {
  try {
    return await telegramPost(path, body, 60_000);
  } catch (e: any) {
    if (e.message === 'timeout' || e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET') {
      console.log('[telegram] First attempt failed, retrying...');
      return await telegramPost(path, body, 30_000);
    }
    throw e;
  }
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
  lines.push(escapeMd(signal.rationale.slice(0, 800)));
  return lines.join('\n');
}

export async function sendTelegramMessage(text: string, parseMode: 'MarkdownV2' | 'HTML' = 'MarkdownV2') {
  const { token, chatId } = await getTelegramConfig();
  if (!token || !chatId) throw new Error('Telegram bot token or chat id not configured');
  const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
  if (!safeToken) throw new Error('Telegram bot token is empty after sanitization');
  if (!safeChatId) throw new Error('Telegram chat ID is empty after sanitization');

  let result: { status: number; text: string };
  try {
    result = await telegramPostWithRetry(
      `/bot${safeToken}/sendMessage`,
      { chat_id: safeChatId, text, parse_mode: parseMode }
    );
  } catch (err: any) {
    if (err.message === 'timeout' || err.code === 'ETIMEDOUT') {
      throw new Error('Telegram API timed out after retry. All Telegram IPs unreachable from this server.');
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
      const { token, chatId } = await getTelegramConfig();
      const safeToken = token.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      const safeChatId = chatId.replace(/[^\x20-\x7E]/g, '').replace(/^["'`]+|["'`]+$/g, '').trim();
      try {
        const result = await telegramPostWithRetry(
          `/bot${safeToken}/sendMessage`,
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
          throw new Error('Telegram API timed out after retry. All Telegram IPs unreachable from this server.');
        }
        throw err;
      }
    } else {
      throw e;
    }
  }
  return true;
}
