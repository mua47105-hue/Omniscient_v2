'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Holding {
  id: string;
  assetSymbol: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  notes?: string | null;
  createdAt: string;
}

interface TickerLite {
  symbol: string;
  lastPrice: number;
  priceChangePercent?: number;
}

interface PricesResponse {
  success?: boolean;
  data?: TickerLite[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUsd(n: number, max = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1) return `$${n.toLocaleString('en-US', { maximumFractionDigits: max })}`;
  return `$${n.toFixed(4)}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(2)}%`;
}

// Binance wants BTCUSDT-style symbols; append USDT if user gave bare ticker.
function toBinanceSymbol(sym: string): string {
  const u = sym.toUpperCase();
  if (u.endsWith('USDT') || u.endsWith('USD')) return u.endsWith('USDT') ? u : u + 'T';
  return u + 'USDT';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PortfolioClient(): React.ReactElement {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Holding | null>(null);

  const holdingsQ = useQuery<Holding[]>({
    queryKey: ['portfolio-holdings'],
    queryFn: async () => {
      const res = await fetch('/api/portfolio');
      if (!res.ok) throw new Error('portfolio fetch failed');
      const json: { success?: boolean; data?: Holding[] } = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const symbols = React.useMemo(() => {
    const set = new Set<string>();
    for (const h of holdingsQ.data ?? []) set.add(toBinanceSymbol(h.assetSymbol));
    return Array.from(set);
  }, [holdingsQ.data]);

  const pricesQ = useQuery<TickerLite[]>({
    queryKey: ['portfolio-prices', symbols.join(',')],
    queryFn: async () => {
      if (!symbols.length) return [];
      // Reuse the existing /api/crypto/prices (returns all active assets)
      // then filter for the ones we care about. Single round-trip.
      const res = await fetch('/api/crypto/prices');
      if (!res.ok) throw new Error('prices fetch failed');
      const json: PricesResponse = await res.json();
      const all = json.data ?? [];
      const map = new Map(all.map((t) => [t.symbol, t]));
      return symbols
        .map((s) => map.get(s))
        .filter((t): t is TickerLite => t != null);
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled: symbols.length > 0,
  });

  const priceMap = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const t of pricesQ.data ?? []) m.set(t.symbol, t.lastPrice);
    return m;
  }, [pricesQ.data]);

  const upsertMut = useMutation({
    mutationFn: async (payload: {
      id?: string;
      assetSymbol: string;
      quantity: number;
      entryPrice: number;
      entryDate?: string;
      notes?: string;
    }) => {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('upsert failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio-holdings'] });
      setOpen(false);
      setEditing(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/portfolio?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('delete failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portfolio-holdings'] });
    },
  });

  const holdings = holdingsQ.data ?? [];

  // Build enriched rows: each holding + current price + P&L.
  const rows = React.useMemo(() => {
    return holdings.map((h) => {
      const ticker = toBinanceSymbol(h.assetSymbol);
      const current = priceMap.get(ticker) ?? null;
      const cost = h.quantity * h.entryPrice;
      const value = current != null ? h.quantity * current : null;
      const pnl = value != null ? value - cost : null;
      const pnlPct = value != null && cost > 0 ? ((value - cost) / cost) * 100 : null;
      return { ...h, ticker, current, cost, value, pnl, pnlPct };
    });
  }, [holdings, priceMap]);

  const totals = React.useMemo(() => {
    let cost = 0;
    let value = 0;
    let counted = 0;
    for (const r of rows) {
      cost += r.cost;
      if (r.value != null) {
        value += r.value;
        counted++;
      }
    }
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { cost, value, pnl, pnlPct, pricedCount: counted, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Portfolio</h1>
          <p className="text-xs text-muted-foreground">
            Holdings tracker with live P&amp;L. Prices refresh every 30s via Binance.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add Holding
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total Cost Basis
              </span>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">{fmtUsd(totals.cost)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {totals.total} {totals.total === 1 ? 'position' : 'positions'}
            </div>
          </CardContent>
        </Card>
        <Card className="ring-1 ring-inset ring-border/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Current Value
              </span>
              <TrendingUp className="h-4 w-4 text-emerald-300" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">{fmtUsd(totals.value)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {totals.pricedCount}/{totals.total} priced
            </div>
          </CardContent>
        </Card>
        <Card
          className={cn(
            'ring-1 ring-inset ring-border/30',
            totals.pnl >= 0 ? 'border-emerald-500/30' : 'border-rose-500/30',
          )}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Total P&amp;L
              </span>
              {totals.pnl >= 0 ? (
                <TrendingUp className="h-4 w-4 text-emerald-300" />
              ) : (
                <TrendingDown className="h-4 w-4 text-rose-300" />
              )}
            </div>
            <div
              className={cn(
                'mt-2 text-2xl font-bold',
                totals.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300',
              )}
            >
              {fmtUsd(totals.pnl)}
            </div>
            <div
              className={cn(
                'mt-1 font-mono text-[11px]',
                totals.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400',
              )}
            >
              {fmtPct(totals.pnlPct)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Holdings table */}
      <Card>
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
        </CardHeader>
        <CardContent>
          {holdingsQ.isLoading ? (
            <div className="p-6 text-center text-xs text-muted-foreground">Loading holdings…</div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <Wallet className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                No holdings yet. Click &quot;Add Holding&quot; to start tracking your portfolio.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Current</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">P&amp;L</TableHead>
                  <TableHead className="text-right">P&amp;L %</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">{r.assetSymbol}</span>
                        {r.notes ? (
                          <span className="text-[10px] text-muted-foreground">{r.notes}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.quantity.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtUsd(r.entryPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.current != null ? fmtUsd(r.current) : <Badge variant="muted">n/a</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.value != null ? fmtUsd(r.value) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono text-xs',
                        r.pnl == null
                          ? 'text-muted-foreground'
                          : r.pnl >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400',
                      )}
                    >
                      {r.pnl != null ? fmtUsd(r.pnl) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono text-xs',
                        r.pnlPct == null
                          ? 'text-muted-foreground'
                          : r.pnlPct >= 0
                            ? 'text-emerald-400'
                            : 'text-rose-400',
                      )}
                    >
                      {r.pnlPct != null ? fmtPct(r.pnlPct) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setEditing(r);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-rose-400 hover:text-rose-300"
                          onClick={() => deleteMut.mutate(r.id)}
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

      <HoldingDialog
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
// HoldingDialog — create/edit form
// ---------------------------------------------------------------------------

interface HoldingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Holding | null;
  onSubmit: (payload: {
    id?: string;
    assetSymbol: string;
    quantity: number;
    entryPrice: number;
    entryDate?: string;
    notes?: string;
  }) => void;
  saving: boolean;
}

function HoldingDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  saving,
}: HoldingDialogProps): React.ReactElement {
  const [assetSymbol, setAssetSymbol] = React.useState(editing?.assetSymbol ?? '');
  const [quantity, setQuantity] = React.useState(editing ? String(editing.quantity) : '');
  const [entryPrice, setEntryPrice] = React.useState(editing ? String(editing.entryPrice) : '');
  const [entryDate, setEntryDate] = React.useState(
    editing?.entryDate
      ? editing.entryDate.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = React.useState(editing?.notes ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    const price = parseFloat(entryPrice);
    if (!assetSymbol.trim() || !Number.isFinite(qty) || !Number.isFinite(price)) return;
    onSubmit({
      id: editing?.id,
      assetSymbol: assetSymbol.trim(),
      quantity: qty,
      entryPrice: price,
      entryDate: entryDate || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Holding' : 'Add Holding'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="symbol">Asset Symbol</Label>
            <Input
              id="symbol"
              value={assetSymbol}
              onChange={(e) => setAssetSymbol(e.target.value)}
              placeholder="BTC, ETH, SOL…"
              disabled={!!editing}
            />
            <p className="text-[10px] text-muted-foreground">
              Crypto symbol. USDT pair auto-resolved for live prices.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qty">Quantity</Label>
              <Input
                id="qty"
                type="number"
                step="any"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0.5"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price">Entry Price (USD)</Label>
              <Input
                id="price"
                type="number"
                step="any"
                min="0"
                value={entryPrice}
                onChange={(e) => setEntryPrice(e.target.value)}
                placeholder="42000"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Entry Date</Label>
            <Input
              id="date"
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. long-term hold, DCA batch 3"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
