'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Lock, Loader2, Eye, EyeOff, Activity } from 'lucide-react';
import { toast } from 'sonner';

export function LockClient() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Welcome to OMNISCIENT');
        router.push('/');
        router.refresh();
      } else {
        toast.error('Wrong password');
        setPassword('');
      }
    } catch {
      toast.error('Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div
        aria-hidden
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle 900px at 0% 0%, oklch(0.55 0.28 255 / 0.65), transparent 55%),' +
            'radial-gradient(circle 800px at 100% 15%, oklch(0.60 0.25 300 / 0.55), transparent 55%),' +
            'radial-gradient(circle 700px at 30% 100%, oklch(0.65 0.25 160 / 0.50), transparent 55%),' +
            'radial-gradient(circle 600px at 80% 70%, oklch(0.60 0.22 70 / 0.45), transparent 55%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center mb-8">
          <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-xl shadow-blue-500/30 ring-1 ring-white/20 mb-4">
            <Activity className="h-8 w-8" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">OMNISCIENT</h1>
          <p className="text-sm text-muted-foreground mt-1">Market Intelligence System</p>
        </div>
        <div
          className="rounded-[20px] p-8"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow: 'inset 0 1px 1px 0 rgba(255,255,255,0.20), 0 8px 32px -4px rgba(0,0,0,0.40)',
          }}
        >
          <div className="flex items-center gap-2 mb-6">
            <Lock className="h-4 w-4 text-blue-500" />
            <span className="text-sm font-medium text-muted-foreground">Enter password to access</span>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 pr-11 text-sm font-medium outline-none transition-all placeholder:text-muted-foreground/50 focus:border-blue-500/50 focus:bg-white/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/25 transition-all hover:from-blue-600 hover:to-blue-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              {loading ? 'Verifying…' : 'Unlock'}
            </button>
          </form>
        </div>
        <p className="text-center text-xs text-muted-foreground/50 mt-6">
          OMNISCIENT · Global Market Intelligence · 24/7
        </p>
      </motion.div>
    </div>
  );
}
