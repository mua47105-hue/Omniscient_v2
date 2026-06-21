'use client';

import * as React from 'react';

/**
 * WebSocket hook for Binance combined ticker stream.
 *
 * Binance's combined stream endpoint pushes lightweight ticker payloads for any
 * number of symbols over a single connection. We open one socket per mount and
 * expose a `tickers` map keyed by symbol.
 *
 * Free tier — no API key required. Gracefully closes on unmount and reconnects
 * on error.
 */

export interface TickerEntry {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  fetchedAt: number;
}

interface BinanceStreamMessage {
  stream: string;
  data: {
    s: string; // symbol
    c: string; // close
    p: string; // price change
    P: string; // price change percent
    h: string; // high
    l: string; // low
    v: string; // base volume
    q: string; // quote volume
    E: number; // event time
  };
}

export function useLiveTicker(symbols: string[]): {
  tickers: Record<string, TickerEntry>;
  connected: boolean;
} {
  const [tickers, setTickers] = React.useState<Record<string, TickerEntry>>({});
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!symbols.length) return;
    const streams = symbols
      .map((s) => `${s.toLowerCase()}@miniTicker`)
      .join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;

    const handleMessage = (ev: MessageEvent) => {
      try {
        const msg: BinanceStreamMessage = JSON.parse(ev.data);
        const d = msg.data;
        if (!d || !d.s) return;
        setTickers((prev) => ({
          ...prev,
          [d.s]: {
            symbol: d.s,
            lastPrice: parseFloat(d.c),
            priceChange: parseFloat(d.p),
            priceChangePercent: parseFloat(d.P),
            high: parseFloat(d.h),
            low: parseFloat(d.l),
            volume: parseFloat(d.v),
            quoteVolume: parseFloat(d.q),
            fetchedAt: Date.now(),
          },
        }));
      } catch {
        /* ignore parse errors */
      }
    };

    const connect = () => {
      try {
        ws = new WebSocket(url);
        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          if (!closedByUs) {
            reconnectTimer = setTimeout(connect, 3000);
          }
        };
        ws.onerror = () => {
          ws?.close();
        };
        ws.onmessage = handleMessage;
      } catch {
        /* WebSocket not available (SSR) — silent */
      }
    };

    connect();

    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [symbols.join(',')]);

  return { tickers, connected };
}
