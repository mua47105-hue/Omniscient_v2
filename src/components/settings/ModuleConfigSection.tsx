'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Plug,
  Loader2,
  Save,
  Trash2,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Power,
  Thermometer,
  Hash,
  Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { ApiResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Types — subset of Prisma models for client use.
// ---------------------------------------------------------------------------
interface LlmModel {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  freeTierRpm: number;
  isActive: boolean;
}

interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  notes: string | null;
  models: LlmModel[];
}

interface ModuleConfig {
  id: string;
  moduleKey: string;
  layer: string;
  modelId: string;
  providerId: string;
  temperature: number;
  systemPrompt: string | null;
  enabled: boolean;
  model: LlmModel & { provider: LlmProvider };
  provider: LlmProvider;
}

// ---------------------------------------------------------------------------
// Known modules — drives the table. New modules can be added here later.
// ---------------------------------------------------------------------------
interface KnownModule {
  moduleKey: string;
  layer: string;
  label: string;
  description: string;
}

const KNOWN_MODULES: KnownModule[] = [
  {
    moduleKey: 'news_sentiment',
    layer: 'sentiment',
    label: 'News Sentiment',
    description: 'Batch sentiment + impact analysis on news articles (used by /news page).',
  },
  {
    moduleKey: 'crypto_technical',
    layer: 'deep_reasoning',
    label: 'Crypto Deep Reasoning',
    description: 'LLM layer that fuses technical + orderbook + funding into a trade thesis.',
  },
  {
    moduleKey: 'macro_analysis',
    layer: 'macro',
    label: 'Macro Analysis',
    description: 'LLM read of macro indicators (DXY, yields, commodities, indices).',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j: ApiResult<T> = await r.json().catch(() => ({ success: false, error: 'Invalid JSON' }) as any);
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

const isPlaceholderKey = (k: string) => !k || k.startsWith('PASTE_') || k.includes('YOUR_');
const providerReady = (p: LlmProvider) => p.isActive && !isPlaceholderKey(p.apiKey);

// Build a composite key for the "provider|model" select value.
function makeOptionValue(providerId: string, modelId: string) {
  return `${providerId}::${modelId}`;
}
function parseOptionValue(v: string): { providerId: string; modelId: string } | null {
  const parts = v.split('::');
  if (parts.length !== 2) return null;
  return { providerId: parts[0], modelId: parts[1] };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ModuleConfigSection() {
  const [providers, setProviders] = useState<LlmProvider[] | null>(null);
  const [configs, setConfigs] = useState<ModuleConfig[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [prov, cfg] = await Promise.all([
        api<LlmProvider[]>('/api/llm/providers'),
        api<ModuleConfig[]>('/api/llm/module-configs'),
      ]);
      setProviders(prov);
      setConfigs(cfg);
    } catch (e: any) {
      toast.error('Failed to load module configs', { description: e.message });
      setProviders([]);
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Map (moduleKey|layer) → config for quick lookup.
  const configMap = useMemo(() => {
    const m = new Map<string, ModuleConfig>();
    for (const c of configs ?? []) {
      m.set(`${c.moduleKey}|${c.layer}`, c);
    }
    return m;
  }, [configs]);

  const readyProviders = (providers ?? []).filter(providerReady);
  const totalModels = readyProviders.reduce((s, p) => s + (p.models?.length ?? 0), 0);
  const wiredCount = (configs ?? []).filter((c) => c.enabled).length;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Plug className="h-4 w-4 text-emerald-500" />
              Module → Model Mapping
            </CardTitle>
            <CardDescription className="text-xs">
              Wire a specific provider + model to each analysis module. Modules without a mapping
              run in <span className="text-amber-500">tiered mode</span> (numeric layers only, no LLM).
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-500 gap-1">
            <CheckCircle2 className="h-3 w-3" /> {wiredCount}/{KNOWN_MODULES.length} wired
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : !providers || providers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto text-amber-500 mb-2" />
            <p className="text-sm font-medium">No LLM providers configured</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add a provider and paste an API key above, then return here to wire it to a module.
            </p>
          </div>
        ) : readyProviders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-500/30 bg-amber-500/[0.04] p-6 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto text-amber-500 mb-2" />
            <p className="text-sm font-medium text-amber-500">No ready providers</p>
            <p className="text-xs text-muted-foreground mt-1">
              Activate at least one provider above (paste a real API key + flip the Active switch)
              before wiring modules.
            </p>
          </div>
        ) : totalModels === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Cpu className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">No models available</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add at least one model under a ready provider above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {KNOWN_MODULES.map((m, i) => {
              const cfg = configMap.get(`${m.moduleKey}|${m.layer}`);
              return (
                <motion.div
                  key={`${m.moduleKey}|${m.layer}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.2 }}
                >
                  <ModuleRow
                    module={m}
                    config={cfg}
                    providers={readyProviders}
                    onChanged={reload}
                  />
                </motion.div>
              );
            })}
            <p className="text-[11px] text-muted-foreground/70 pt-1">
              Tip: temperature 0.1–0.3 is best for analytical tasks; 0.5–0.7 for narrative
              synthesis. Changes are saved per row.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Single module row
// ---------------------------------------------------------------------------
function ModuleRow({
  module,
  config,
  providers,
  onChanged,
}: {
  module: KnownModule;
  config?: ModuleConfig;
  providers: LlmProvider[];
  onChanged: () => void;
}) {
  // Local draft state — initialized from existing config or defaults.
  const initialOption = config
    ? makeOptionValue(config.providerId, config.modelId)
    : '';
  const [selected, setSelected] = useState<string>(initialOption);
  const [tempDraft, setTempDraft] = useState<string>(
    config ? config.temperature.toFixed(2) : '0.20',
  );
  const [enabled, setEnabled] = useState<boolean>(config?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync state if the underlying config changes after refetch.
  useEffect(() => {
    setSelected(config ? makeOptionValue(config.providerId, config.modelId) : '');
    setTempDraft(config ? config.temperature.toFixed(2) : '0.20');
    setEnabled(config?.enabled ?? true);
  }, [config?.id, config?.providerId, config?.modelId, config?.temperature, config?.enabled]);

  const isWired = !!config;
  const dirty =
    selected !== (config ? makeOptionValue(config.providerId, config.modelId) : '') ||
    Number.parseFloat(tempDraft || '0').toFixed(2) !==
      (config ? config.temperature.toFixed(2) : '0.20') ||
    enabled !== (config?.enabled ?? true);

  const save = async () => {
    if (!selected) {
      toast.error('Pick a model first', { description: module.label });
      return;
    }
    const parsed = parseOptionValue(selected);
    if (!parsed) {
      toast.error('Invalid model selection');
      return;
    }
    const tempNum = Number.parseFloat(tempDraft || '0.2');
    if (Number.isNaN(tempNum)) {
      toast.error('Invalid temperature', { description: 'Must be a number 0–2.' });
      return;
    }
    setSaving(true);
    try {
      await api<ModuleConfig>('/api/llm/module-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleKey: module.moduleKey,
          layer: module.layer,
          modelId: parsed.modelId,
          providerId: parsed.providerId,
          temperature: tempNum,
          enabled,
        }),
      });
      toast.success('Module mapping saved', {
        description: `${module.label} → ${selected.split('::')[1]}`,
      });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to save mapping', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!config) return;
    setDeleting(true);
    try {
      await api(`/api/llm/module-configs?id=${config.id}`, { method: 'DELETE' });
      toast.success('Module mapping removed', { description: module.label });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to remove mapping', { description: e.message });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border p-3 sm:p-4 transition-colors',
        isWired
          ? enabled
            ? 'border-emerald-500/30 bg-emerald-500/[0.03]'
            : 'border-border/60 bg-muted/20'
          : 'border-dashed border-amber-500/30 bg-amber-500/[0.02]',
      )}
    >
      <div className="flex flex-col lg:flex-row lg:items-start gap-3 lg:gap-4">
        {/* Left: module identity */}
        <div className="space-y-1 min-w-[220px] lg:flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Layers className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-semibold text-sm">{module.label}</span>
            {isWired ? (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] gap-1',
                  enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                    : 'border-border text-muted-foreground',
                )}
              >
                {enabled ? (
                  <>
                    <CheckCircle2 className="h-2.5 w-2.5" /> Wired
                  </>
                ) : (
                  <>
                    <Power className="h-2.5 w-2.5" /> Paused
                  </>
                )}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500"
              >
                <AlertTriangle className="h-2.5 w-2.5" /> Not wired
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{module.description}</p>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70 font-mono">
            <span className="inline-flex items-center gap-1">
              <Hash className="h-2.5 w-2.5" />
              {module.moduleKey}
            </span>
            <span className="opacity-40">·</span>
            <span className="inline-flex items-center gap-1">
              <Layers className="h-2.5 w-2.5" />
              {module.layer}
            </span>
          </div>
        </div>

        {/* Middle: provider/model + temperature */}
        <div className="flex flex-col sm:flex-row gap-3 lg:flex-1 lg:items-end">
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Provider · Model
            </Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger size="sm" className="w-full font-mono text-xs">
                <SelectValue placeholder="Pick a provider → model…" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => {
                  const activeModels = (p.models ?? []).filter((m) => m.isActive);
                  if (activeModels.length === 0) return null;
                  return (
                    <SelectGroup key={p.id}>
                      <SelectLabel className="text-[10px] uppercase tracking-wider">
                        {p.name}
                      </SelectLabel>
                      {activeModels.map((m) => (
                        <SelectItem
                          key={m.id}
                          value={makeOptionValue(p.id, m.id)}
                          className="font-mono text-xs"
                        >
                          {m.modelId}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 w-full sm:w-24">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Thermometer className="h-2.5 w-2.5" /> Temp
            </Label>
            <Input
              type="number"
              step="0.05"
              min={0}
              max={2}
              value={tempDraft}
              onChange={(e) => setTempDraft(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex items-center gap-2 sm:pt-5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor={`enabled-${module.moduleKey}`} className="text-[10px] text-muted-foreground">
                Enabled
              </Label>
              <Switch
                id={`enabled-${module.moduleKey}`}
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!isWired && !selected}
              />
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 lg:flex-shrink-0">
          <Button
            size="sm"
            onClick={save}
            disabled={saving || !selected || !dirty}
            className={cn(
              'gap-1.5',
              dirty && selected
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : '',
            )}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : isWired ? 'Update' : 'Save'}
          </Button>
          {isWired && (
            <Button
              size="sm"
              variant="outline"
              onClick={remove}
              disabled={deleting}
              className="gap-1.5 text-rose-500 hover:text-rose-500 hover:bg-rose-500/10 border-rose-500/30"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Currently-wired summary footer */}
      {isWired && config && (
        <>
          <Separator className="my-3" />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 flex-wrap">
            <span className="text-muted-foreground/60">Currently:</span>
            <Badge variant="outline" className="font-mono text-[10px] gap-1 border-emerald-500/30 bg-emerald-500/5 text-emerald-500">
              {config.provider.name}
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px] gap-1">
              {config.model.modelId}
            </Badge>
            <span className="font-mono text-[10px]">
              temp {config.temperature.toFixed(2)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
