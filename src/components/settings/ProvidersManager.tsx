'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Cpu,
  Plus,
  Eye,
  EyeOff,
  KeyRound,
  ExternalLink,
  Trash2,
  FlaskConical,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Save,
  Zap,
  Clock,
  Hash,
  Brain,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult } from '@/lib/types';

// ----- Types (subset of Prisma models) -----
interface LlmModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  freeTierRpm: number;
  isActive: boolean;
  createdAt: string;
}

interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  models: LlmModel[];
}

interface TestResult {
  content: string;
  model: string;
  latencyMs: number;
}

// ----- Helpers -----
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j: ApiResult<T> = await r.json().catch(() => ({ success: false, error: 'Invalid JSON' }) as any);
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

// Check if the key field has at least one real (non-placeholder) key.
// Supports multi-line keys — returns true only if ALL lines are placeholders/empty.
const isPlaceholderKey = (k: string) => {
  if (!k) return true;
  const realKeys = k.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('PASTE_') && !s.includes('YOUR_'));
  return realKeys.length === 0;
};

const providerReady = (p: LlmProvider) => p.isActive && !isPlaceholderKey(p.apiKey);
const providerHasModels = (p: LlmProvider) => (p.models?.length ?? 0) > 0;

function extractHelpLink(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/https?:\/\/[^\s]+/);
  return m ? m[0] : null;
}

// ----- Main component -----
export function ProvidersManager() {
  const [providers, setProviders] = useState<LlmProvider[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<LlmProvider[]>('/api/llm/providers');
      setProviders(data);
    } catch (e: any) {
      toast.error('Failed to load providers', { description: e.message });
      setProviders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const readyCount = (providers ?? []).filter(providerReady).length;
  const totalModels = (providers ?? []).reduce((s, p) => s + (p.models?.length ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">LLM Providers</h1>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">
              <Cpu className="h-3 w-3" /> {readyCount}/{providers?.length ?? 0} ready
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Paste your API keys below to activate providers. Test each model before wiring it into a module. {totalModels} models available.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4" /> Add Provider
            </Button>
          </DialogTrigger>
          <AddProviderDialog
            onDone={() => {
              setAddOpen(false);
              reload();
            }}
          />
        </Dialog>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : !providers || providers.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-12 text-center">
            <Cpu className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm text-muted-foreground">No LLM providers configured.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Click "Add Provider" to wire up your first model.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.25 }}
            >
              <ProviderCard provider={p} onChanged={reload} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Provider Card -----
function ProviderCard({ provider, onChanged }: { provider: LlmProvider; onChanged: () => void }) {
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState(provider.apiKey);
  const [savingKey, setSavingKey] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);

  // Sync local draft when provider reloads
  useEffect(() => {
    setKeyDraft(provider.apiKey);
  }, [provider.apiKey]);

  const ready = providerReady(provider);
  const hasModels = providerHasModels(provider);
  const firstActiveModel = provider.models?.find((m) => m.isActive) ?? provider.models?.[0];
  const helpLink = extractHelpLink(provider.notes);

  const dirty = keyDraft !== provider.apiKey;

  const saveKey = async () => {
    if (!dirty) return;
    setSavingKey(true);
    try {
      await api<LlmProvider>('/api/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: keyDraft.trim(),
          notes: provider.notes,
          isActive: provider.isActive,
        }),
      });
      toast.success('API key saved', { description: provider.name });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to save key', { description: e.message });
    } finally {
      setSavingKey(false);
    }
  };

  const toggleActive = async (checked: boolean) => {
    setToggling(true);
    try {
      await api('/api/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          notes: provider.notes,
          isActive: checked,
        }),
      });
      toast.success(checked ? 'Provider activated' : 'Provider paused', { description: provider.name });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to toggle provider', { description: e.message });
    } finally {
      setToggling(false);
    }
  };

  const testProvider = async () => {
    if (!firstActiveModel) {
      toast.error('No model to test', { description: 'Add a model under this provider first.' });
      return;
    }
    if (isPlaceholderKey(provider.apiKey)) {
      toast.error('Paste a real API key first', { description: 'The current key is a placeholder.' });
      return;
    }
    setTesting(true);
    try {
      const r = await api<TestResult>('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.name, model: firstActiveModel.modelId }),
      });
      toast.success('Model responded', {
        description: `${firstActiveModel.modelId} · ${r.latencyMs}ms · "${r.content?.slice(0, 60) ?? ''}"`,
      });
    } catch (e: any) {
      toast.error('Test failed', { description: e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className={cn('border-border/60 transition-colors', ready ? 'border-emerald-500/30' : '')}>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          {/* Left: name + badges */}
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                ready
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : 'bg-muted/60 text-muted-foreground'
              )}
            >
              <Brain className="h-5 w-5" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{provider.name}</CardTitle>
                {ready ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-500 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Ready
                  </Badge>
                ) : provider.isActive && isPlaceholderKey(provider.apiKey) ? (
                  <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500 gap-1">
                    <AlertTriangle className="h-3 w-3" /> Needs key
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-border text-muted-foreground gap-1">
                    <Clock className="h-3 w-3" /> Paused
                  </Badge>
                )}
                <Badge variant="secondary" className="gap-1">
                  <Hash className="h-3 w-3" /> {provider.models?.length ?? 0} models
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]">{provider.baseUrl}</code>
                {helpLink && (
                  <a
                    href={helpLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-emerald-500 hover:underline"
                  >
                    Get key <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {provider.notes && (
                <p className="text-xs text-muted-foreground/80 max-w-2xl leading-relaxed">{provider.notes}</p>
              )}
            </div>
          </div>

          {/* Right: active switch + test */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <Label htmlFor={`active-${provider.id}`} className="text-xs text-muted-foreground">
                Active
              </Label>
              <Switch
                id={`active-${provider.id}`}
                checked={provider.isActive}
                onCheckedChange={toggleActive}
                disabled={toggling}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={testProvider}
              disabled={testing || !hasModels}
              className="gap-1.5"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              {testing ? 'Testing…' : 'Test'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* API key input — supports multiple keys (one per line) */}
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <KeyRound className="h-3 w-3" /> API Key{keyDraft.split('\n').filter(k => k.trim() && !k.startsWith('PASTE_')).length > 1 ? `s (${keyDraft.split('\n').filter(k => k.trim() && !k.startsWith('PASTE_')).length})` : ''}
          </Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Textarea
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={saveKey}
                placeholder="Paste your API key here…&#10;Add multiple keys (one per line) to rotate and avoid rate limits."
                rows={2}
                className={cn(
                  'pr-10 font-mono text-xs resize-y min-h-[60px]',
                  isPlaceholderKey(keyDraft) && 'border-amber-500/40',
                  dirty && 'border-emerald-500/50'
                )}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button
              variant={dirty ? 'default' : 'outline'}
              size="sm"
              onClick={saveKey}
              disabled={savingKey || !dirty}
              className={cn('gap-1.5 shrink-0', dirty && 'bg-emerald-600 hover:bg-emerald-700 text-white')}
            >
              {savingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {savingKey ? 'Saving…' : 'Save'}
            </Button>
          </div>
          {isPlaceholderKey(keyDraft) ? (
            <p className="text-xs text-amber-500/90">⚠ Key is placeholder — paste a real key to activate this provider.</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70">
              💡 Tip: Paste multiple keys (one per line) to rotate automatically and avoid rate limits. When one key gets 429'd, the next key is used automatically.
            </p>
          )}
        </div>

        <Separator />

        {/* Models collapsible */}
        <Collapsible open={modelsOpen} onOpenChange={setModelsOpen}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1.5 px-2">
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform', modelsOpen && 'rotate-180')}
                />
                Models
                <Badge variant="secondary" className="ml-1">{provider.models?.length ?? 0}</Badge>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="pt-3">
            <ModelsSection provider={provider} onChanged={onChanged} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

// ----- Models Section (inside provider card) -----
function ModelsSection({ provider, onChanged }: { provider: LlmProvider; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const models = provider.models ?? [];

  return (
    <div className="space-y-2">
      {models.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No models yet. Add one below.
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          {/* Header row (hidden on mobile) */}
          <div className="hidden md:grid grid-cols-[1.5fr_2fr_1fr_1fr_0.6fr_auto] gap-3 px-3 py-2 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            <div>Model ID</div>
            <div>Display Name</div>
            <div>Context</div>
            <div>RPM</div>
            <div className="text-center">Active</div>
            <div className="text-right">Actions</div>
          </div>
          <div className="divide-y divide-border/60">
            {models.map((m) => (
              <ModelRow key={m.id} model={m} provider={provider} onChanged={onChanged} />
            ))}
          </div>
        </div>
      )}

      {addOpen ? (
        <AddModelForm
          providerId={provider.id}
          onDone={() => {
            setAddOpen(false);
            onChanged();
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add model
        </Button>
      )}
    </div>
  );
}

// ----- Model Row -----
function ModelRow({
  model,
  provider,
  onChanged,
}: {
  model: LlmModel;
  provider: LlmProvider;
  onChanged: () => void;
}) {
  const [toggling, setToggling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleActive = async (checked: boolean) => {
    setToggling(true);
    try {
      await api('/api/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: model.id,
          providerId: provider.id,
          modelId: model.modelId,
          displayName: model.displayName,
          contextWindow: model.contextWindow,
          freeTierRpm: model.freeTierRpm,
          isActive: checked,
        }),
      });
      toast.success(checked ? 'Model enabled' : 'Model disabled', { description: model.displayName });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to toggle model', { description: e.message });
    } finally {
      setToggling(false);
    }
  };

  const testModel = async () => {
    if (isPlaceholderKey(provider.apiKey)) {
      toast.error('Paste a real provider key first', { description: 'Provider API key is a placeholder.' });
      return;
    }
    setTesting(true);
    try {
      const r = await api<TestResult>('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.name, model: model.modelId }),
      });
      toast.success('Model responded', {
        description: `${r.latencyMs}ms · "${r.content?.slice(0, 60) ?? ''}"`,
      });
    } catch (e: any) {
      toast.error('Test failed', { description: e.message });
    } finally {
      setTesting(false);
    }
  };

  const removeModel = async () => {
    setDeleting(true);
    try {
      await api(`/api/llm/models?id=${encodeURIComponent(model.id)}`, { method: 'DELETE' });
      toast.success('Model deleted', { description: model.displayName });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to delete model', { description: e.message });
      setDeleting(false);
    }
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-[1.5fr_2fr_1fr_1fr_0.6fr_auto] gap-2 md:gap-3 px-3 py-2.5 items-center hover:bg-muted/30 transition-colors">
      <div className="font-mono text-xs truncate" title={model.modelId}>
        {model.modelId}
      </div>
      <div className="text-xs text-muted-foreground truncate" title={model.displayName}>
        {model.displayName}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {model.contextWindow >= 1000 ? `${Math.round(model.contextWindow / 1000)}K` : model.contextWindow}
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">{model.freeTierRpm}</div>
      <div className="flex justify-center">
        <Switch checked={model.isActive} onCheckedChange={toggleActive} disabled={toggling} />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
          onClick={testModel}
          disabled={testing}
          title="Test model"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
          onClick={removeModel}
          disabled={deleting}
          title="Delete model"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

// ----- Add Model Form (inline) -----
function AddModelForm({
  providerId,
  onDone,
  onCancel,
}: {
  providerId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [modelId, setModelId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [contextWindow, setContextWindow] = useState('128000');
  const [freeTierRpm, setFreeTierRpm] = useState('10');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!modelId.trim() || !displayName.trim()) {
      toast.error('Model ID and Display Name are required');
      return;
    }
    setSaving(true);
    try {
      await api('/api/llm/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId,
          modelId: modelId.trim(),
          displayName: displayName.trim(),
          contextWindow: Number(contextWindow) || 128000,
          freeTierRpm: Number(freeTierRpm) || 10,
          isActive: true,
        }),
      });
      toast.success('Model added', { description: displayName });
      onDone();
    } catch (e: any) {
      toast.error('Failed to add model', { description: e.message });
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="h-4 w-4 text-emerald-500" /> New model
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Model ID *</Label>
          <Input
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. gemini-2.0-flash"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Display Name *</Label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Gemini 2.0 Flash"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Context Window (tokens)</Label>
          <Input
            type="number"
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Free Tier RPM</Label>
          <Input
            type="number"
            value={freeTierRpm}
            onChange={(e) => setFreeTierRpm(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={submit}
          disabled={saving}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add model
        </Button>
      </div>
    </div>
  );
}

// ----- Add Provider Dialog -----
function AddProviderDialog({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim() || !baseUrl.trim()) {
      toast.error('Name and Base URL are required');
      return;
    }
    setSaving(true);
    try {
      await api('/api/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim() || 'PASTE_YOUR_API_KEY',
          notes: notes.trim() || null,
          isActive: false,
        }),
      });
      toast.success('Provider added', { description: name });
      setName('');
      setBaseUrl('');
      setApiKey('');
      setNotes('');
      onDone();
    } catch (e: any) {
      toast.error('Failed to add provider', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>Add LLM Provider</DialogTitle>
        <DialogDescription>
          Add a custom OpenAI-compatible provider. After saving, paste your API key on the card and toggle Active.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Provider Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Together AI" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Base URL *</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.together.xyz/v1"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">API Key (optional now)</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste key, or skip and add later"
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Notes / Help text</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Where to get the key, free tier limits, etc."
          />
        </div>
      </div>
      <DialogFooter>
        <Button
          onClick={submit}
          disabled={saving}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add provider
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
