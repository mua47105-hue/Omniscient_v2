'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Database, Save, Globe, Calendar } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SettingsPageHeader, useSaveState } from '@/components/settings/SettingsHubClient';

export function DataSourcesClient(): React.ReactElement {
  const [finnhubKey, setFinnhubKey] = React.useState('');

  React.useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json: { data?: Record<string, unknown> }) => {
        setFinnhubKey((json.data?.['finnhub.api_key'] as string) ?? '');
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const saveState = useSaveState();

  const saveMut = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'finnhub.api_key', value: key }),
      });
      if (!res.ok) throw new Error('save failed');
      return true;
    },
    onMutate: () => saveState.start(),
    onSuccess: () => saveState.succeed(),
    onError: (err: Error) => saveState.fail(err.message),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="Data Sources"
        description="API keys for external data providers. All keys are optional — the app degrades gracefully when a source is unavailable."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Finnhub
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="finnhub">API Key</Label>
            <Input
              id="finnhub"
              type="password"
              value={finnhubKey}
              onChange={(e) => setFinnhubKey(e.target.value)}
              placeholder="your-finnhub-api-key"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Used by the Economic Calendar for live event data. Free tier: 60 calls/min. Get one at{' '}
              <a
                href="https://finnhub.io/register"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                finnhub.io/register
              </a>
              .
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => saveMut.mutate(finnhubKey)} disabled={saveState.saving}>
              <Save className="h-3.5 w-3.5" />
              {saveState.saving ? 'Saving…' : 'Save'}
            </Button>
            {saveState.saved ? (
              <Badge variant="success" className="text-[10px]">Saved</Badge>
            ) : null}
            {saveState.error ? (
              <Badge variant="rose" className="text-[10px]">{saveState.error}</Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Other Sources
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[11px] text-muted-foreground">
          <SourceRow name="Binance Futures" desc="Crypto tickers + klines + orderbook. No key needed (public API)." status="active" />
          <SourceRow name="Yahoo Finance" desc="Macro quotes (DXY, VIX, Gold, etc.). No key needed." status="active" />
          <SourceRow name="CoinGecko" desc="Global crypto market cap + dominance. No key needed." status="active" />
          <SourceRow name="Alternative.me" desc="Fear & Greed index. No key needed." status="active" />
          <SourceRow name="Reddit" desc="/r/CryptoCurrency + /r/Bitcoin sentiment. No key needed." status="active" />
          <SourceRow name="Deribit" desc="Options DVOL + put/call ratios. No key needed." status="active" />
          <SourceRow name="RSS feeds" desc="CoinDesk, Cointelegraph, Decrypt. No key needed." status="active" />
        </CardContent>
      </Card>
    </div>
  );
}

function SourceRow({
  name,
  desc,
  status,
}: {
  name: string;
  desc: string;
  status: 'active' | 'inactive';
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="flex flex-col">
        <span className="font-mono text-[11px] font-semibold text-foreground">{name}</span>
        <span className="text-[10px] text-muted-foreground">{desc}</span>
      </div>
      <Badge variant={status === 'active' ? 'success' : 'muted'} className="text-[10px] capitalize">
        {status}
      </Badge>
    </div>
  );
}
