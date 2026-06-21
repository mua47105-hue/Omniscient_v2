'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  Plug,
  Eye,
  EyeOff,
  Table2,
  ShieldCheck,
  Terminal,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult } from '@/lib/types';

interface SchemaResponse {
  sql: string;
  tables: readonly string[];
  configured: boolean;
}

interface TestResult {
  ok: boolean;
  error?: string;
  tableExists?: boolean;
}

export function SupabaseManager() {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [copied, setCopied] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ totalSynced: number; totalErrors: number; durationMs: number } | null>(null);

  // Load saved credentials + schema on mount
  const loadData = useCallback(async () => {
    try {
      const [settingsRes, schemaRes] = await Promise.all([
        fetch('/api/settings', { cache: 'no-store' }),
        fetch('/api/supabase/schema', { cache: 'no-store' }),
      ]);
      const settings = (await settingsRes.json()) as ApiResult<Record<string, any>>;
      const schemaData = (await schemaRes.json()) as ApiResult<SchemaResponse>;
      if (settings.success && settings.data) {
        const savedUrl = settings.data.supabase_url;
        const savedKey = settings.data.supabase_anon_key;
        if (savedUrl && !String(savedUrl).startsWith('PASTE_')) setUrl(savedUrl);
        if (savedKey && !String(savedKey).startsWith('PASTE_')) setAnonKey(savedKey);
      }
      if (schemaData.success && schemaData.data) {
        setSchema(schemaData.data);
      }
    } catch (e: any) {
      toast.error('Failed to load Supabase settings');
    } finally {
      setInitialLoading(false);
      setLoadingSchema(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save credentials
  const handleSave = async () => {
    if (!url.trim() || !anonKey.trim()) {
      toast.error('Please enter both Project URL and anon key');
      return;
    }
    if (!url.trim().startsWith('https://')) {
      toast.error('Project URL must start with https://');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabase_url: url.trim(),
          supabase_anon_key: anonKey.trim(),
        }),
      });
      const j = (await res.json()) as ApiResult<{ ok: boolean }>;
      if (j.success) {
        toast.success('Supabase credentials saved');
        setTestResult(null); // reset test result so user re-tests
      } else {
        toast.error(j.error ?? 'Failed to save');
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/supabase/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }),
      });
      const text = await res.text();
      let j: ApiResult<TestResult>;
      try { j = JSON.parse(text); } catch { j = { success: false, error: 'Server error — check if DATABASE_URL is configured' }; }
      if (j.success && j.data) {
        setTestResult(j.data);
        if (j.data.ok && j.data.tableExists) {
          toast.success('Connected! All tables found.');
        } else if (j.data.ok && !j.data.tableExists) {
          toast.warning('Connected, but tables not created yet — run the SQL schema below.');
        } else {
          toast.error(j.data.error ?? 'Connection failed');
        }
      } else {
        setTestResult({ ok: false, error: j.error });
        toast.error(j.error ?? 'Connection failed');
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e.message });
      toast.error(e.message ?? 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  // Copy SQL to clipboard
  const handleCopySql = async () => {
    if (!schema?.sql) return;
    try {
      await navigator.clipboard.writeText(schema.sql);
      setCopied(true);
      toast.success('SQL schema copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('Failed to copy — select the text manually');
    }
  };

  // Sync all local data to Supabase
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/supabase/sync', { method: 'POST' });
      const j = (await res.json()) as ApiResult<{ totalSynced: number; totalErrors: number; durationMs: number }>;
      if (j.success && j.data) {
        setSyncResult(j.data);
        if (j.data.totalErrors === 0) {
          toast.success(`Synced ${j.data.totalSynced} rows to Supabase`, {
            description: `All 16 tables synced in ${(j.data.durationMs / 1000).toFixed(1)}s`,
          });
        } else {
          toast.warning(`Synced ${j.data.totalSynced} rows with ${j.data.totalErrors} errors`);
        }
      } else {
        toast.error(j.error || 'Sync failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const isConfigured = !!url && !!anonKey && url.startsWith('https://') && !anonKey.startsWith('PASTE_');
  const connected = testResult?.ok && testResult?.tableExists;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-teal-500/10 text-emerald-500">
            <Database className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Supabase</h1>
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5',
              connected
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                : isConfigured
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                  : 'border-border bg-muted/40 text-muted-foreground'
            )}
          >
            {connected ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Connected
              </>
            ) : isConfigured ? (
              <>
                <AlertTriangle className="h-3 w-3" />
                Needs tables
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
                Not configured
              </>
            )}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Connect your Supabase project to persist data in the cloud. Enter your Project URL + anon key below,
          then run the SQL schema in your Supabase SQL Editor to create all tables.
        </p>
      </div>

      {/* Connection Form */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4 text-emerald-500" />
            Connection
          </CardTitle>
          <CardDescription className="text-xs">
            Find these in your Supabase Dashboard → Project Settings → API. The anon key is the public key —
            it&apos;s safe to use here because RLS is disabled by default (personal dashboard).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* URL */}
          <div className="space-y-1.5">
            <Label htmlFor="supabase-url" className="text-xs font-medium">
              Project URL
            </Label>
            <Input
              id="supabase-url"
              type="url"
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={initialLoading}
              className="font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Settings → API → Project URL
            </p>
          </div>

          {/* Anon Key */}
          <div className="space-y-1.5">
            <Label htmlFor="supabase-key" className="text-xs font-medium">
              anon / public key
            </Label>
            <div className="relative">
              <Input
                id="supabase-key"
                type={showKey ? 'text' : 'password'}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                disabled={initialLoading}
                className="font-mono text-sm pr-10"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Settings → API → Project API Keys → <span className="font-mono">anon</span> (public)
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={saving || !url.trim() || !anonKey.trim()}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </Button>
            <Button
              onClick={handleTest}
              disabled={testing || !url.trim() || !anonKey.trim()}
              variant="outline"
              className="gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              Test Connection
            </Button>
            <Button
              onClick={loadData}
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Reload"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Test result */}
          {testResult && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs',
                testResult.ok && testResult.tableExists
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : testResult.ok && !testResult.tableExists
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400'
              )}
            >
              {testResult.ok && testResult.tableExists ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="space-y-0.5">
                <p className="font-medium">
                  {testResult.ok && testResult.tableExists
                    ? 'Connection successful — all tables are ready.'
                    : testResult.ok && !testResult.tableExists
                      ? 'Connection OK — but tables are missing.'
                      : 'Connection failed.'}
                </p>
                {testResult.error && (
                  <p className="font-mono text-[11px] opacity-80 break-all">{testResult.error}</p>
                )}
                {testResult.ok && !testResult.tableExists && (
                  <p className="opacity-80">Copy the SQL schema below and run it in your Supabase SQL Editor.</p>
                )}
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Data Sync — push local data to Supabase */}
      {connected && (
        <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-blue-500" />
              Data Sync
            </CardTitle>
            <CardDescription className="text-xs">
              Push all local data (signals, assets, providers, settings, etc.) to your Supabase tables.
              This is a one-way sync: local SQLite → Supabase. Safe to run multiple times (upserts by ID).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSync}
                disabled={syncing}
                className="gap-2"
              >
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {syncing ? 'Syncing…' : 'Sync Now'}
              </Button>
              {syncResult && !syncing && (
                <div className={cn(
                  'flex items-center gap-2 text-xs rounded-lg border px-3 py-2',
                  syncResult.totalErrors === 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                )}>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {syncResult.totalSynced} rows synced
                  {syncResult.totalErrors > 0 && ` (${syncResult.totalErrors} errors)`}
                  {' '}in {(syncResult.durationMs / 1000).toFixed(1)}s
                </div>
              )}
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
              <p className="font-medium flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                How data flow works
              </p>
              <p className="mt-1 leading-relaxed opacity-90">
                The app reads/writes to local SQLite for speed. Click <strong>Sync Now</strong> to push
                a snapshot of all data to Supabase for cloud backup. Run it after making config changes
                or generating new signals. In production, this runs automatically after each scheduler tick.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SQL Schema Section */}
      <Card className="border-border/60 bg-card/50 backdrop-blur-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4 text-emerald-500" />
                SQL Schema Setup
              </CardTitle>
              <CardDescription className="text-xs">
                Run this in your Supabase Dashboard → SQL Editor → New query. It creates all{' '}
                {schema?.tables.length ?? 16} tables with the correct columns, indexes, and triggers.
                Safe to re-run (drops + recreates).
              </CardDescription>
            </div>
            <Button
              onClick={handleCopySql}
              disabled={!schema?.sql || loadingSchema}
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy SQL
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Steps */}
          <div className="grid gap-2 sm:grid-cols-3">
            <StepCard
              num={1}
              title="Open SQL Editor"
              desc="Supabase Dashboard → SQL → New query"
              href="https://supabase.com/dashboard"
              icon={ExternalLink}
            />
            <StepCard
              num={2}
              title="Paste & Run"
              desc="Paste the SQL below, click Run"
              icon={Terminal}
            />
            <StepCard
              num={3}
              title="Test Connection"
              desc="Come back here, click Test Connection"
              icon={ShieldCheck}
            />
          </div>

          {/* Tables list */}
          {schema?.tables && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Table2 className="h-3.5 w-3.5" />
                {schema.tables.length} tables:
              </span>
              {schema.tables.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="font-mono text-[10px] py-0.5 px-1.5 border-border/60 bg-muted/30"
                >
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {/* SQL code block */}
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-10 bg-muted/40 border-r border-border/50 select-none pointer-events-none" />
            <Textarea
              readOnly
              value={schema?.sql ?? ''}
              className="min-h-[400px] max-h-[600px] resize-y font-mono text-[11px] leading-relaxed bg-zinc-950/60 border-border/50 rounded-md pl-14 pr-3 overflow-auto [scrollbar-width:thin]"
              spellCheck={false}
              onClick={(e) => e.currentTarget.select()}
              placeholder={loadingSchema ? 'Loading SQL...' : ''}
            />
            <div className="absolute left-2 top-2 text-[10px] font-mono text-muted-foreground/60 select-none pointer-events-none">
              SQL
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            <ShieldCheck className="inline h-3 w-3 mr-1 -mt-0.5" />
            RLS is <span className="font-medium">disabled</span> on all tables — the anon key can read/write
            directly. This is fine for a personal dashboard. If you want Row Level Security, enable it in
            Supabase and add policies for the <code className="font-mono">anon</code> role.
          </p>
        </CardContent>
      </Card>

      {/* Help / External links */}
      <Card className="border-border/60 bg-gradient-to-br from-emerald-500/[0.04] to-transparent">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-500">
                  <Database className="h-3.5 w-3.5" />
                </span>
                Where to find your credentials
              </h3>
              <p className="text-xs text-muted-foreground">
                Supabase Dashboard → your project → Settings (gear icon) → API
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Supabase Dashboard
                </a>
              </Button>
              <Button asChild variant="ghost" size="sm" className="gap-1.5">
                <a href="https://supabase.com/docs/guides/getting-started" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Docs
                </a>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({
  num,
  title,
  desc,
  icon: Icon,
  href,
}: {
  num: number;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const content = (
    <div className="group flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/20 p-3 hover:border-emerald-500/30 hover:bg-emerald-500/[0.03] transition-all">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-[11px] font-bold text-emerald-500">
        {num}
      </div>
      <div className="space-y-0.5 min-w-0">
        <p className="text-xs font-medium flex items-center gap-1">
          {title}
          {href && <Icon className="h-3 w-3 text-muted-foreground group-hover:text-emerald-500 transition-colors" />}
        </p>
        <p className="text-[11px] text-muted-foreground leading-snug">{desc}</p>
      </div>
    </div>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block">
      {content}
    </a>
  ) : (
    content
  );
}
