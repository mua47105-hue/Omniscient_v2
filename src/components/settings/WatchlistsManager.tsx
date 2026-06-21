'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ListChecks,
  Plus,
  Trash2,
  X,
  Save,
  Loader2,
  Pencil,
  Check,
  Bitcoin,
  DollarSign,
  Coins,
  LineChart,
  BarChart3,
  CircleDashed,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ApiResult, AssetClass } from '@/lib/types';

// ----- Types -----
interface Watchlist {
  id: string;
  name: string;
  assetClass: string | null;
  symbols: string; // JSON string array
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ----- Helpers -----
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j: ApiResult<T> = await r.json().catch(() => ({ success: false, error: 'Invalid JSON' }) as any);
  if (!j.success) throw new Error(j.error ?? 'Request failed');
  return j.data as T;
}

const parseSymbols = (s: string): string[] => {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

const ASSET_CLASS_OPTIONS: { value: AssetClass | 'mixed'; label: string; icon: any }[] = [
  { value: 'crypto', label: 'Crypto', icon: Bitcoin },
  { value: 'forex', label: 'Forex', icon: DollarSign },
  { value: 'commodity', label: 'Commodity', icon: Coins },
  { value: 'index', label: 'Index', icon: LineChart },
  { value: 'stock', label: 'Stock', icon: BarChart3 },
  { value: 'mixed', label: 'Mixed', icon: CircleDashed },
];

const classColor: Record<string, string> = {
  crypto: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  forex: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
  commodity: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500',
  index: 'border-teal-500/30 bg-teal-500/10 text-teal-500',
  stock: 'border-rose-500/30 bg-rose-500/10 text-rose-500',
  mixed: 'border-border bg-muted/40 text-muted-foreground',
};

// ----- Main -----
export function WatchlistsManager() {
  const [watchlists, setWatchlists] = useState<Watchlist[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      const data = await api<Watchlist[]>('/api/watchlists');
      setWatchlists(data);
    } catch (e: any) {
      toast.error('Failed to load watchlists', { description: e.message });
      setWatchlists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalSymbols = (watchlists ?? []).reduce(
    (s, w) => s + parseSymbols(w.symbols).length,
    0
  );
  const activeCount = (watchlists ?? []).filter((w) => w.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Watchlists</h1>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-500">
              <ListChecks className="h-3 w-3" /> {activeCount} active
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Group assets by class. The scanner monitors all symbols across active lists each cycle. {totalSymbols} symbols across {watchlists?.length ?? 0} lists.
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4" /> New Watchlist
            </Button>
          </DialogTrigger>
          <AddWatchlistDialog
            onDone={() => {
              setAddOpen(false);
              reload();
            }}
          />
        </Dialog>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : !watchlists || watchlists.length === 0 ? (
        <Card className="border-dashed border-border">
          <CardContent className="py-12 text-center">
            <ListChecks className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
            <p className="text-sm text-muted-foreground">No watchlists yet.</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Create one to start tracking assets.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {watchlists.map((w, i) => (
            <motion.div
              key={w.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.25 }}
            >
              <WatchlistCard watchlist={w} onChanged={reload} />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- Watchlist Card -----
function WatchlistCard({ watchlist, onChanged }: { watchlist: Watchlist; onChanged: () => void }) {
  const symbols = parseSymbols(watchlist.symbols);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(watchlist.name);
  const [assetClass, setAssetClass] = useState<string>(watchlist.assetClass ?? 'mixed');
  const [symbolsDraft, setSymbolsDraft] = useState(symbols.join(', '));
  const [toggling, setToggling] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const cls = assetClass || 'mixed';
  const ClassIcon = ASSET_CLASS_OPTIONS.find((o) => o.value === cls)?.icon ?? CircleDashed;

  const startEdit = () => {
    setName(watchlist.name);
    setAssetClass(watchlist.assetClass ?? 'mixed');
    setSymbolsDraft(parseSymbols(watchlist.symbols).join(', '));
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    const symArr = symbolsDraft
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await api('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: watchlist.id,
          name: name.trim(),
          assetClass: assetClass === 'mixed' ? null : assetClass,
          symbols: symArr,
          isActive: watchlist.isActive,
        }),
      });
      toast.success('Watchlist saved', { description: name });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      toast.error('Failed to save watchlist', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (checked: boolean) => {
    setToggling(true);
    const symArr = parseSymbols(watchlist.symbols);
    try {
      await api('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: watchlist.id,
          name: watchlist.name,
          assetClass: watchlist.assetClass,
          symbols: symArr,
          isActive: checked,
        }),
      });
      toast.success(checked ? 'Watchlist activated' : 'Watchlist paused', { description: watchlist.name });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to toggle watchlist', { description: e.message });
    } finally {
      setToggling(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api(`/api/watchlists?id=${encodeURIComponent(watchlist.id)}`, { method: 'DELETE' });
      toast.success('Watchlist deleted', { description: watchlist.name });
      onChanged();
    } catch (e: any) {
      toast.error('Failed to delete watchlist', { description: e.message });
      setDeleting(false);
    }
  };

  return (
    <Card className={cn('border-border/60', watchlist.isActive && 'border-emerald-500/30')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                classColor[cls] || classColor.mixed
              )}
            >
              <ClassIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 space-y-1">
              {editing ? (
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-8 text-sm font-semibold"
                />
              ) : (
                <CardTitle className="text-base truncate">{watchlist.name}</CardTitle>
              )}
              <div className="flex items-center gap-2">
                {editing ? (
                  <Select value={assetClass} onValueChange={setAssetClass}>
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_CLASS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className={cn('text-[10px] capitalize', classColor[cls] || classColor.mixed)}>
                    {watchlist.assetClass ?? 'mixed'}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  {symbols.length} symbols
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="flex items-center gap-1.5 mr-1">
              <Label htmlFor={`wl-active-${watchlist.id}`} className="sr-only">
                Active
              </Label>
              <Switch
                id={`wl-active-${watchlist.id}`}
                checked={watchlist.isActive}
                onCheckedChange={toggleActive}
                disabled={toggling}
              />
            </div>
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={cancelEdit}
                  disabled={saving}
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  className="h-7 w-7 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={save}
                  disabled={saving}
                  title="Save"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={startEdit}
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                  onClick={remove}
                  disabled={deleting}
                  title="Delete"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {editing ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Symbols (comma-separated)</Label>
            <Input
              value={symbolsDraft}
              onChange={(e) => setSymbolsDraft(e.target.value)}
              placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground/70">
              Use uppercase ticker symbols. For crypto use BTCUSDT format.
            </p>
          </div>
        ) : (
          <div>
            {symbols.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                No symbols in this list.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {symbols.map((s) => (
                  <Badge
                    key={s}
                    variant="secondary"
                    className="font-mono text-[11px] py-1 px-2"
                  >
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {!editing && (
          <>
            <Separator />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Updated {new Date(watchlist.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
              <Button variant="ghost" size="sm" onClick={startEdit} className="h-7 gap-1 text-xs">
                <Pencil className="h-3 w-3" /> Edit symbols
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ----- Add Watchlist Dialog -----
function AddWatchlistDialog({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState<string>('crypto');
  const [symbols, setSymbols] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    const symArr = symbols
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await api('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          assetClass: assetClass === 'mixed' ? null : assetClass,
          symbols: symArr,
          isActive: true,
        }),
      });
      toast.success('Watchlist created', { description: name });
      setName('');
      setSymbols('');
      setAssetClass('crypto');
      onDone();
    } catch (e: any) {
      toast.error('Failed to create watchlist', { description: e.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle>New Watchlist</DialogTitle>
        <DialogDescription>Create a group of symbols for the scanner to monitor.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Name *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. AI Coins" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Asset Class</Label>
          <Select value={assetClass} onValueChange={setAssetClass}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_CLASS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Symbols (comma-separated)</Label>
          <Input
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            placeholder="BTCUSDT, ETHUSDT, SOLUSDT"
            className="font-mono text-xs"
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
          Create watchlist
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
