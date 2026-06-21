'use client';

import { useState } from 'react';
import { Lock, Save, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export function SecurityClient() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!password) { toast.error('Enter a password'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      // Save to the database (works on local dev)
      // On Vercel, set the APP_PASSWORD environment variable in project settings
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_password: password }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Password updated', {
          description: 'For Vercel deployments, also set APP_PASSWORD environment variable in Vercel settings for it to take effect.',
        });
        setPassword('');
        setConfirm('');
      } else {
        toast.error(data.error || 'Failed to save');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        </div>
        <p className="text-sm text-muted-foreground">Set the password users must enter to access the dashboard.</p>
      </div>
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-blue-500" /> Change Password
          </CardTitle>
          <CardDescription className="text-xs">
            The default password is &quot;omniscient&quot;. Change it to something only you know.
            For Vercel deployments, also set the <code className="font-mono bg-muted/30 px-1 rounded">APP_PASSWORD</code> environment variable in Vercel project settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">New Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter new password" className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm Password</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" className="font-mono text-sm" />
          </div>
          <Button onClick={handleSave} disabled={saving || !password || !confirm} className="gap-2 w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Password
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
