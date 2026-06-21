'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Bot, Save, Server } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SettingsPageHeader, useSaveState } from '@/components/settings/SettingsHubClient';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LlmModel {
  id: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  freeTierRpm: number;
  isActive: boolean;
  capabilities: string;
}

interface LlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  isActive: boolean;
  notes?: string | null;
  models: LlmModel[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProvidersClient(): React.ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LlmProvider | null>(null);

  const q = useQuery<LlmProvider[]>({
    queryKey: ['llm-providers'],
    queryFn: async () => {
      const res = await fetch('/api/llm/providers');
      if (!res.ok) throw new Error('providers fetch failed');
      const json: { success?: boolean; data?: LlmProvider[] } = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const upsertMut = useMutation({
    mutationFn: async (payload: {
      id?: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      isActive: boolean;
      notes?: string;
    }) => {
      const res = await fetch('/api/llm/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('upsert failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-providers'] });
      setOpen(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/llm/providers?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('delete failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-providers'] });
    },
  });

  const providers = q.data ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="LLM Providers"
        description="Manage free-tier LLM providers. Add API keys (newline-separated for rotation), toggle active, configure base URLs."
      />

      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Providers ({providers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading providers…</div>
          ) : providers.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No providers configured. Click &quot;Add Provider&quot; to get started. Pollinations
              is the default free option (no API key needed).
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>Models</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {p.name}
                        </span>
                        {p.notes ? (
                          <span className="text-[10px] text-muted-foreground">{p.notes}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground">
                      {p.baseUrl}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.apiKey ? `${p.apiKey.slice(0, 4)}…${p.apiKey.slice(-4)}` : '(none)'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="muted" className="text-[10px]">
                        {p.models?.length ?? 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch checked={p.isActive} disabled />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditing(p);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-rose-400 hover:text-rose-300"
                          onClick={() => deleteMut.mutate(p.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ProviderDialog
        key={editing?.id ?? 'new'}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        onSubmit={(payload) => upsertMut.mutate(payload)}
        saving={upsertMut.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProviderDialog
// ---------------------------------------------------------------------------

interface ProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: LlmProvider | null;
  onSubmit: (payload: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    isActive: boolean;
    notes?: string;
  }) => void;
  saving: boolean;
}

const PROVIDER_PRESETS: Array<{ name: string; baseUrl: string }> = [
  { name: 'pollinations', baseUrl: 'https://text.pollinations.ai/openai' },
  { name: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { name: 'groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { name: 'nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  { name: 'mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
];

function ProviderDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  saving,
}: ProviderDialogProps): React.ReactElement {
  const [name, setName] = React.useState(editing?.name ?? '');
  const [baseUrl, setBaseUrl] = React.useState(editing?.baseUrl ?? '');
  const [apiKey, setApiKey] = React.useState(editing?.apiKey ?? '');
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);
  const [notes, setNotes] = React.useState(editing?.notes ?? '');

  const applyPreset = (preset: { name: string; baseUrl: string }) => {
    setName(preset.name);
    setBaseUrl(preset.baseUrl);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) return;
    onSubmit({
      id: editing?.id,
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      apiKey,
      isActive,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            {editing ? 'Edit Provider' : 'Add Provider'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {!editing ? (
            <div className="space-y-1.5">
              <Label>Presets</Label>
              <div className="flex flex-wrap gap-1.5">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className={cn(
                      'rounded border border-border bg-muted/30 px-2 py-1 text-[10px] font-mono transition-colors hover:bg-muted',
                      name === p.name && 'border-primary/40 bg-primary/10',
                    )}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="name">Provider Name (lowercase, unique)</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="pollinations"
              disabled={!!editing}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="base">Base URL</Label>
            <Input
              id="base"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="key">API Key (newline-separated for rotation)</Label>
            <textarea
              id="key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              rows={3}
              className="flex w-full rounded-md border border-input bg-background/50 px-3 py-1.5 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
            <p className="text-[10px] text-muted-foreground">
              Leave empty for Pollinations (free, no key). Multiple keys rotate on 429.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. primary free tier"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
            <Label htmlFor="active" className="text-foreground">
              Active
            </Label>
            <Switch id="active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
