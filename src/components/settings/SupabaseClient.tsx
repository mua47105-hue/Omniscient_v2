'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Cloud, Save, Database } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPageHeader, useSaveState } from '@/components/settings/SettingsHubClient';

export function SupabaseClient(): React.ReactElement {
  const [url, setUrl] = React.useState('');
  const [anonKey, setAnonKey] = React.useState('');
  const [configured, setConfigured] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json: { data?: Record<string, unknown> }) => {
        const u = json.data?.['supabase.url'] as string | undefined;
        const k = json.data?.['supabase.anon_key'] as string | undefined;
        setUrl(u ?? '');
        setAnonKey(k ?? '');
        setConfigured(!!(u && k));
      })
      .catch(() => setConfigured(false));
  }, []);

  const saveState = useSaveState();

  const saveMut = useMutation({
    mutationFn: async (payload: { url: string; anonKey: string }) => {
      const r1 = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'supabase.url', value: payload.url }),
      });
      if (!r1.ok) throw new Error('save url failed');
      const r2 = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'supabase.anon_key', value: payload.anonKey }),
      });
      if (!r2.ok) throw new Error('save key failed');
      return true;
    },
    onMutate: () => saveState.start(),
    onSuccess: () => {
      saveState.succeed();
      setConfigured(!!(url && anonKey));
    },
    onError: (err: Error) => saveState.fail(err.message),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="Supabase"
        description="Optional cloud sync. Configure a Supabase project URL + anon key to mirror signals + alerts to a remote Postgres instance for redundancy."
      />

      <Card className={configured ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-amber-500/20 bg-amber-500/5'}>
        <CardContent className="flex items-start gap-2 p-4">
          <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-emerald-200">Sync Status</span>
            <span>
              {configured === null
                ? 'Checking…'
                : configured
                  ? 'Supabase sync is CONFIGURED. The scheduler will mirror new rows on each tick.'
                  : 'Not configured. Cloud sync is disabled — all data stays in the local SQLite database.'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            Supabase Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="url">Project URL</Label>
            <Input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xyzcompany.supabase.co"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="anon">Anon Key</Label>
            <Input
              id="anon"
              type="password"
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              The anon (public) key is safe to embed in client-side code — it has Row-Level Security
              permissions only. Find it in your Supabase dashboard → Settings → API.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => saveMut.mutate({ url, anonKey })} disabled={saveState.saving}>
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

      <Alert>
        <Database className="h-4 w-4" />
        <AlertTitle>How it works</AlertTitle>
        <AlertDescription>
          When configured, the scheduler tick (every 60s) upserts new Signal and Alert rows to your
          Supabase tables. The remote schema must match the local Prisma schema (see{' '}
          <code className="font-mono">prisma/schema.prisma</code>). The sync is best-effort — network
          errors are logged but never block the tick.
        </AlertDescription>
      </Alert>
    </div>
  );
}
