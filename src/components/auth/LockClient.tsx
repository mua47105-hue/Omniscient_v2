'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { BrainCircuit, Lock, Unlock, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

interface LoginResponse {
  success: boolean;
  error?: string;
}

export function LockClient(): React.ReactElement {
  const router = useRouter();
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const loginMut = useMutation({
    mutationFn: async (pw: string) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const json: LoginResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error ?? 'Login failed');
      }
      return json;
    },
    onSuccess: () => {
      setError(null);
      router.push('/');
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Login failed');
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    loginMut.mutate(password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-violet-950/30 p-4">
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-violet-500/10 blur-3xl ambient-glow" />
        <div className="absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl ambient-glow" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15 ring-1 ring-violet-500/30">
            <BrainCircuit className="h-6 w-6 text-violet-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">OMNISCIENT</h1>
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              market intelligence
            </p>
          </div>
        </div>

        <Card className="border-violet-500/20">
          <CardContent className="p-5">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="pl-8"
                    autoFocus
                    disabled={loginMut.isPending}
                  />
                </div>
              </div>

              {error ? (
                <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
                  {error}
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={loginMut.isPending || !password}
              >
                <Unlock className="h-3.5 w-3.5" />
                {loginMut.isPending ? 'Unlocking…' : 'Unlock'}
              </Button>

              <p className="flex items-center justify-center gap-1 pt-1 text-[10px] text-muted-foreground">
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                Cookie-based · httpOnly · same-site lax
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-[10px] text-muted-foreground/70">
          Default password: <code className="font-mono">omniscient</code> · change in Settings → Security
        </p>
      </div>
    </div>
  );
}
