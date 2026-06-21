'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, Lock, Save, Eye, EyeOff, AlertTriangle } from 'lucide-react';
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

export function SecurityClient(): React.ReactElement {
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [configured, setConfigured] = React.useState<boolean | null>(null);

  // Check if a password is currently set.
  React.useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((json: { data?: Record<string, unknown> }) => {
        const p = json.data?.['app.password'];
        setConfigured(typeof p === 'string' && p.length > 0);
      })
      .catch(() => setConfigured(false));
  }, []);

  const saveState = useSaveState();

  const saveMut = useMutation({
    mutationFn: async (pwd: string) => {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'app.password', value: pwd }),
      });
      if (!res.ok) throw new Error('save failed');
      return true;
    },
    onMutate: () => saveState.start(),
    onSuccess: () => {
      saveState.succeed();
      setConfigured(password.length > 0);
    },
    onError: (err: Error) => saveState.fail(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      saveState.fail('Passwords do not match');
      return;
    }
    if (password.length > 0 && password.length < 4) {
      saveState.fail('Password must be at least 4 characters');
      return;
    }
    saveMut.mutate(password);
  };

  const clearPassword = () => {
    setPassword('');
    setConfirm('');
    saveMut.mutate('');
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="Security"
        description="Gate access to the dashboard with an app password. Empty password = no gate (anyone with the URL can access)."
      />

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="flex items-start gap-2 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-emerald-200">Current Status</span>
            <span>
              {configured === null
                ? 'Checking…'
                : configured
                  ? 'Password protection is ENABLED. The /lock page will prompt for the password on each new session.'
                  : 'No password set — the dashboard is open to anyone with the URL.'}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Set App Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pwd">New Password</Label>
              <div className="relative">
                <Input
                  id="pwd"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? 'Hide' : 'Show'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saveState.saving}>
                <Save className="h-3.5 w-3.5" />
                {saveState.saving ? 'Saving…' : 'Save Password'}
              </Button>
              {configured ? (
                <Button type="button" variant="outline" onClick={clearPassword} disabled={saveState.saving}>
                  Clear Password
                </Button>
              ) : null}
              {saveState.saved ? (
                <Badge variant="success" className="text-[10px]">Saved</Badge>
              ) : null}
              {saveState.error ? (
                <Badge variant="rose" className="text-[10px]">{saveState.error}</Badge>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Warning</AlertTitle>
        <AlertDescription>
          The password is stored as plain text in the local SQLite database. This gate is meant for
          casual access control on a personal deployment, NOT for production authentication. Use a
          reverse proxy with proper auth (Caddy, Cloudflare Access) for internet-exposed instances.
        </AlertDescription>
      </Alert>
    </div>
  );
}
