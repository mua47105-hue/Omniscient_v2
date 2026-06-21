'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, BellRing, Plus, Trash2, Check } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface PriceAlert {
  id: string;
  assetSymbol: string;
  condition: string;
  targetPrice: number;
  currentPrice: number | null;
  status: string;
  channel: string;
  note: string | null;
  triggeredAt: string | null;
  createdAt: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'failed');
  return j.data as T;
}

export function PriceAlertsClient() {
  const qc = useQueryClient();
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [condition, setCondition] = useState('above');
  const [target, setTarget] = useState('');

  const alertsQ = useQuery({ queryKey: ['price-alerts'], queryFn: () => fetchJson<PriceAlert[]>('/api/price-alerts'), refetchInterval: 30000 });

  const createMut = useMutation({
    mutationFn: (data: any) => fetchJson('/api/price-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/price-alerts?id=${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  });

  const checkMut = useMutation({
    mutationFn: () => fetchJson('/api/price-alerts/check', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-alerts'] }),
  });

  const alerts = alertsQ.data ?? [];
  const active = alerts.filter(a => a.status === 'active');
  const triggered = alerts.filter(a => a.status === 'triggered');

  const handleCreate = () => {
    if (!symbol || !target) return;
    createMut.mutate({ assetSymbol: symbol, condition, targetPrice: parseFloat(target), channel: 'dashboard' });
    setTarget('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl flex items-center gap-2">
          <BellRing className="h-6 w-6 text-amber-400" /> Price Alerts
        </h1>
        <p className="text-sm text-muted-foreground">User-defined threshold alerts on any asset</p>
      </div>

      {/* Create alert */}
      <Card className="border-border/60 ring-1 ring-inset ring-border/30">
        <CardHeader><CardTitle className="text-sm">Create Alert</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Asset</Label>
            <Input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="w-32" placeholder="BTCUSDT" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Condition</Label>
            <Select value={condition} onValueChange={setCondition}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="above">Above</SelectItem>
                <SelectItem value="below">Below</SelectItem>
                <SelectItem value="crosses_up">Crosses Up</SelectItem>
                <SelectItem value="crosses_down">Crosses Down</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target Price</Label>
            <Input value={target} onChange={e => setTarget(e.target.value)} className="w-32" type="number" placeholder="65000" />
          </div>
          <Button onClick={handleCreate} disabled={createMut.isPending}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Alert
          </Button>
          <Button variant="outline" onClick={() => checkMut.mutate()} disabled={checkMut.isPending}>
            <Check className="h-4 w-4 mr-1.5" /> Check Now
          </Button>
        </CardContent>
      </Card>

      {/* Active alerts */}
      <Card className="border-border/60 ring-1 ring-inset ring-border/30">
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-amber-400" /> Active ({active.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No active alerts</p>
          ) : active.map(a => (
            <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-sm">{a.assetSymbol}</span>
                <Badge variant="outline" className="text-[10px] capitalize">{a.condition.replace('_', ' ')}</Badge>
                <span className="text-sm tabular-nums">${a.targetPrice.toLocaleString()}</span>
                {a.currentPrice && <span className="text-xs text-muted-foreground">now: ${a.currentPrice.toLocaleString()}</span>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      {/* Triggered alerts */}
      {triggered.length > 0 && (
        <Card className="border-border/60 ring-1 ring-inset ring-border/30">
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BellRing className="h-4 w-4 text-emerald-400" /> Triggered ({triggered.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {triggered.slice(0, 10).map(a => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm">{a.assetSymbol}</span>
                  <Badge variant="outline" className="text-[10px] capitalize text-emerald-400">{a.condition.replace('_', ' ')}</Badge>
                  <span className="text-sm tabular-nums">${a.targetPrice.toLocaleString()}</span>
                  {a.triggeredAt && <span className="text-xs text-muted-foreground">{new Date(a.triggeredAt).toLocaleString()}</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => deleteMut.mutate(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
