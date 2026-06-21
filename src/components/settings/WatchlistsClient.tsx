'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Pencil, Trash2, Save } from 'lucide-react';
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
import { SettingsPageHeader } from '@/components/settings/SettingsHubClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Watchlist {
  id: string;
  name: string;
  assetClass?: string | null;
  symbols: string; // JSON
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WatchlistsClient(): React.ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Watchlist | null>(null);

  const q = useQuery<Watchlist[]>({
    queryKey: ['watchlists'],
    queryFn: async () => {
      const res = await fetch('/api/watchlists');
      if (!res.ok) throw new Error('watchlists fetch failed');
      const json: { success?: boolean; data?: Watchlist[] } = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const upsertMut = useMutation({
    mutationFn: async (payload: {
      id?: string;
      name: string;
      assetClass?: string;
      symbols: string[];
      isActive: boolean;
    }) => {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('upsert failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['watchlists'] });
      setOpen(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/watchlists?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlists'] }),
  });

  const watchlists = q.data ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <SettingsPageHeader
        title="Watchlists"
        description="Named groups of symbols the brain monitors. Symbols are stored as a JSON array (uppercase Binance-style for crypto)."
      />

      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Watchlist
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            Watchlists ({watchlists.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {q.isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading…</div>
          ) : watchlists.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No watchlists yet. Click &quot;Add Watchlist&quot; to create one.
            </div>
          ) : (
            watchlists.map((w) => {
              const symbols = parseSymbols(w.symbols);
              return (
                <div
                  key={w.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{w.name}</span>
                      {w.assetClass ? (
                        <Badge variant="info" className="text-[10px]">
                          {w.assetClass}
                        </Badge>
                      ) : null}
                      <Switch checked={w.isActive} disabled />
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {symbols.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">No symbols</span>
                      ) : (
                        symbols.slice(0, 12).map((s) => (
                          <Badge key={s} variant="muted" className="text-[10px] font-mono">
                            {s}
                          </Badge>
                        ))
                      )}
                      {symbols.length > 12 ? (
                        <span className="text-[10px] text-muted-foreground">
                          +{symbols.length - 12} more
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        setEditing(w);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-rose-400 hover:text-rose-300"
                      onClick={() => deleteMut.mutate(w.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <WatchlistDialog
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

function parseSymbols(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

interface WatchlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Watchlist | null;
  onSubmit: (payload: {
    id?: string;
    name: string;
    assetClass?: string;
    symbols: string[];
    isActive: boolean;
  }) => void;
  saving: boolean;
}

function WatchlistDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  saving,
}: WatchlistDialogProps): React.ReactElement {
  const [name, setName] = React.useState(editing?.name ?? '');
  const [assetClass, setAssetClass] = React.useState(editing?.assetClass ?? '');
  const [symbolsText, setSymbolsText] = React.useState(
    editing ? parseSymbols(editing.symbols).join(', ') : '',
  );
  const [isActive, setIsActive] = React.useState(editing?.isActive ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const symbols = symbolsText
      .split(/[,\s\n]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    onSubmit({
      id: editing?.id,
      name: name.trim(),
      assetClass: assetClass.trim() || undefined,
      symbols,
      isActive,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Watchlist' : 'Add Watchlist'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Top majors"
              disabled={!!editing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ac">Asset Class (optional)</Label>
            <Input
              id="ac"
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              placeholder="crypto"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sym">Symbols (comma- or space-separated)</Label>
            <textarea
              id="sym"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
              rows={4}
              className="flex w-full rounded-md border border-input bg-background/50 px-3 py-1.5 font-mono text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
            <Label htmlFor="active" className="text-foreground">Active</Label>
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
