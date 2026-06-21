'use client';

import { useEffect, useState } from 'react';
import type { Ticker } from '@/lib/types';

export type LiveConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface UseLiveTickerResult {
  /** Map of symbol -> latest ticker snapshot. */
  tickers: Record<string, Ticker>;
  /** Current websocket connection status. */
  status: LiveConnectionStatus;
  /** Timestamp (ms) of the last message received. */
  lastMessageAt: number | null;
}

const WS_BASE = 'wss://stream.binance.com:9443/stream';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_BACKOFF_MS = 30_000;

function parseCombinedMessage(raw: string): Ticker | null {
  try {
    const msg = JSON.parse(raw);
    const d = msg?.data;
    if (!d || !d.s) return null;
    return {
      symbol: d.s,
      price: parseFloat(d.c),
      changePct: parseFloat(d.P),
      high: parseFloat(d.h),
      low: parseFloat(d.l),
      volume: parseFloat(d.v),
      quoteVolume: parseFloat(d.q),
      updatedAt: d.E,
    };
  } catch {
    return null;
  }
}

/**
 * Subscribe to one or more Binance ticker streams over a single combined
 * WebSocket connection. Reconnects automatically with exponential-ish backoff
 * and exposes a live connection status indicator.
 *
 * @param symbols Uppercase Binance symbols, e.g. ['BTCUSDT', 'ETHUSDT'].
 */
export function useLiveTicker(symbols: string[]): UseLiveTickerResult {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const [status, setStatus] = useState<LiveConnectionStatus>('connecting');
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null);

  // Stable key for the dependency array — we re-subscribe only when the SET of
  // symbols changes, not when the array reference identity changes.
  const symbolsKey = symbols.filter(Boolean).map((s) => s.toUpperCase()).sort().join(',');

  useEffect(() => {
    if (symbolsKey.length === 0) {
      // No symbols to stream — mark as disconnected. Deferred via setTimeout
      // so it's not a synchronous setState in the effect body.
      const t = setTimeout(() => setStatus('disconnected'), 0);
      return () => clearTimeout(t);
    }
    if (typeof WebSocket === 'undefined') return; // SSR guard

    let mounted = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let intentionalClose = false;
    let attempts = 0;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (!mounted) return;
      clearReconnect();
      attempts += 1;
      const delay = Math.min(
        RECONNECT_DELAY_MS * Math.pow(1.5, attempts - 1),
        MAX_RECONNECT_BACKOFF_MS
      );
      setStatus((prev) => (prev === 'connected' ? 'disconnected' : 'reconnecting'));
      reconnectTimer = setTimeout(() => {
        if (!mounted) return;
        connect();
      }, delay);
    };

    const connect = () => {
      if (!mounted) return;
      intentionalClose = false;
      const syms = symbolsKey.split(',');
      const streams = syms.map((s) => `${s.toLowerCase()}@ticker`).join('/');
      try {
        ws = new WebSocket(`${WS_BASE}?streams=${streams}`);
      } catch (err) {
        console.error('[useLiveTicker] WebSocket constructor failed', err);
        setStatus('disconnected');
        scheduleReconnect();
        return;
      }

      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');

      ws.onopen = () => {
        if (!mounted) return;
        attempts = 0;
        setStatus('connected');
      };

      ws.onmessage = (ev) => {
        if (!mounted) return;
        const t = parseCombinedMessage(ev.data as string);
        if (!t) return;
        setTickers((prev) => ({ ...prev, [t.symbol]: t }));
        setLastMessageAt(Date.now());
      };

      ws.onerror = (e) => {
        // Errors are usually followed by close, where we trigger reconnect.
        console.error('[useLiveTicker] socket error', e);
      };

      ws.onclose = () => {
        ws = null;
        if (!mounted) return;
        if (intentionalClose) return;
        setStatus('disconnected');
        scheduleReconnect();
      };
    };

    attempts = 0;
    connect();

    return () => {
      mounted = false;
      clearReconnect();
      intentionalClose = true;
      if (ws) {
        try {
          ws.onclose = null;
          ws.onerror = null;
          ws.onmessage = null;
          ws.onopen = null;
          ws.close();
        } catch {
          /* noop */
        }
        ws = null;
      }
    };
  }, [symbolsKey]);

  return { tickers, status, lastMessageAt };
}

export default useLiveTicker;
