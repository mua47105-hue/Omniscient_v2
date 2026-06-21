'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, Send, Save, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPageHeader, useSaveState } from '@/components/settings/SettingsHubClient';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlertsClient(): React.ReactElement {
  const [botToken, setBotToken] = React.useState('');
  const [chatId, setChatId] = React.useState('');
  const [testResult, setTestResult] = React.useState<{ ok: boolean; msg: string } | null>(null);

  // Load current values on mount.
  React.useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json: { data?: Record<string, unknown> }) => {
        const d = json.data ?? {};
        setBotToken((d['telegram.bot_token'] as string) ?? '');
        setChatId((d['telegram.chat_id'] as string) ?? '');
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  const saveState = useSaveState();

  const saveMut = useMutation({
    mutationFn: async (payload: { token: string; chatId: string }) => {
      // Save both keys via the existing /api/settings endpoint.
      const r1 = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'telegram.bot_token', value: payload.token }),
      });
      if (!r1.ok) throw new Error('save token failed');
      const r2 = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'telegram.chat_id', value: payload.chatId }),
      });
      if (!r2.ok) throw new Error('save chatId failed');
      return true;
    },
    onMutate: () => saveState.start(),
    onSuccess: () => saveState.succeed(),
    onError: (err: Error) => saveState.fail(err.message),
  });

  const testMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'test failed');
      }
      return json;
    },
    onSuccess: () => setTestResult({ ok: true, msg: 'Test message delivered to your chat.' }),
    onError: (err: Error) => setTestResult({ ok: false, msg: err.message }),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="Alerts"
        description="Configure Telegram delivery for signals and price-trigger alerts. Test the connection before relying on it."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            Telegram Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="token">Bot Token</Label>
            <Input
              id="token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Get this from <code className="font-mono">@BotFather</code> on Telegram.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat">Chat ID</Label>
            <Input
              id="chat"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890 or 1234567890"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Numeric ID — negative for channels/groups, positive for private chats. Use{' '}
              <code className="font-mono">@userinfobot</code> to find yours.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => saveMut.mutate({ token: botToken, chatId })}
              disabled={saveState.saving}
            >
              <Save className="h-3.5 w-3.5" />
              {saveState.saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="outline"
              onClick={() => testMut.mutate()}
              disabled={testMut.isPending || !botToken || !chatId}
            >
              <Send className="h-3.5 w-3.5" />
              {testMut.isPending ? 'Sending…' : 'Send Test'}
            </Button>
            {saveState.saved ? (
              <Badge variant="success" className="text-[10px]">
                Saved
              </Badge>
            ) : null}
            {saveState.error ? (
              <Badge variant="rose" className="text-[10px]">
                {saveState.error}
              </Badge>
            ) : null}
          </div>

          {testResult ? (
            <Alert variant={testResult.ok ? 'default' : 'destructive'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{testResult.ok ? 'Success' : 'Failed'}</AlertTitle>
              <AlertDescription>{testResult.msg}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[11px] text-muted-foreground">
          <div className="flex items-start gap-2">
            <Badge variant="info" className="text-[10px]">dashboard</Badge>
            <span>Shown in the Notifications feed (always on).</span>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="violet" className="text-[10px]">telegram</Badge>
            <span>Pushed to your Telegram chat when both bot token + chat ID are set.</span>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="warning" className="text-[10px]">webhook</Badge>
            <span>Reserved — not yet wired. Use the Telegram channel for now.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
