/**
 * Telegram alert delivery.
 *
 *  - Reads `telegram.bot_token` and `telegram.chat_id` from the Setting KV.
 *  - Returns true on success, false on any failure (missing config, network
 *    error, non-200 response).
 *  - Uses native `fetch` (Telegram is fine with it — no Cloudflare bot issue).
 */
import { getSetting, SETTING_KEYS } from '@/lib/config/settings';
import type { ConsensusResult } from '@/lib/types';

const TELEGRAM_API = 'https://api.telegram.org';

function fmt(consensus: ConsensusResult): string {
  const dir = consensus.direction.toUpperCase();
  const arrow = consensus.direction === 'long' ? '🟢' : consensus.direction === 'short' ? '🔴' : '⚪';
  const lines: string[] = [];
  lines.push(`${arrow} *OMNISCIENT SIGNAL* — ${consensus.symbol} ${dir}`);
  lines.push(`Conviction: *${consensus.conviction}/100* · Score: *${consensus.summaryScore}*`);
  if (consensus.entryPrice != null) {
    lines.push(`Entry: \`${consensus.entryPrice}\``);
  }
  if (consensus.stopLoss != null) {
    lines.push(`Stop: \`${consensus.stopLoss}\``);
  }
  if (consensus.takeProfit != null) {
    lines.push(`Target: \`${consensus.takeProfit}\``);
  }
  // Truncate the layer rationale to keep Telegram happy.
  const rationale = (consensus.rationale || '').slice(0, 800);
  lines.push('');
  lines.push(rationale);
  return lines.join('\n');
}

export async function sendSignalAlert(consensus: ConsensusResult): Promise<boolean> {
  const token = await getSetting<string>(SETTING_KEYS.telegramBotToken);
  const chatId = await getSetting<string>(SETTING_KEYS.telegramChatId);
  if (!token || !chatId) {
    console.warn('[telegram] missing bot token or chat id — skipping alert');
    return false;
  }
  if (consensus.direction === 'neutral') {
    // Don't spam Telegram for neutral signals.
    return false;
  }

  const text = fmt(consensus);
  const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
  try {
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
      console.error(`[telegram] sendMessage failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] sendMessage error:', err);
    return false;
  }
}
