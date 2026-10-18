'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'

async function call(method: 'GET' | 'POST', body?: Record<string, unknown>) {
  const res = await fetch('/api/admin/auth/mfa', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminAccessToken() || ''}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data }
}

// Admin Settings > Security: turn two-step sign-in (authenticator app) on or off.
export function AdminMfaCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpAuthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { ok, data } = await call('GET')
    if (ok) setEnabled(!!data.enabled)
  }, [])
  useEffect(() => { load() }, [load])

  const start = async () => {
    setBusy(true)
    const { ok, data } = await call('POST', { action: 'setup' })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'Could not start setup')
    setSetup(data)
  }

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { ok, data } = await call('POST', { action: 'enable', code })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'That code is not right')
    setBackupCodes(data.backupCodes)
    setSetup(null)
    setCode('')
    setEnabled(true)
    toast.success('Two-step sign-in is on')
  }

  const turnOff = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { ok, data } = await call('POST', { action: 'disable', password })
    setBusy(false)
    if (!ok) return toast.error(data.error || 'Could not turn it off')
    setPassword('')
    setBackupCodes(null)
    setEnabled(false)
    toast.success('Two-step sign-in is off')
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Two-step sign-in
          {enabled && <Badge variant="secondary">On</Badge>}
        </CardTitle>
        <CardDescription>
          Ask for a code from an authenticator app (Google Authenticator, Authy, 1Password) after your password.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        {backupCodes && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Backup codes: save them now, they won&apos;t be shown again.</p>
            <p className="text-xs text-muted-foreground">Each one works once if you lose your phone.</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm select-all">
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
          </div>
        )}

        {enabled === false && !setup && (
          <Button onClick={start} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Set up two-step sign-in
          </Button>
        )}

        {setup && (
          <form onSubmit={confirm} className="space-y-3">
            <Button asChild variant="outline">
              <a href={setup.otpAuthUrl}>Add to authenticator app</a>
            </Button>
            <p className="text-xs text-muted-foreground">Or enter this key in the app:</p>
            <code className="block text-sm font-mono bg-muted px-3 py-1.5 rounded select-all break-all">{setup.secret}</code>
            <div className="space-y-2">
              <Label htmlFor="admin-mfa-code">6-digit code from the app</Label>
              <Input id="admin-mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Turn on
            </Button>
          </form>
        )}

        {enabled && (
          <form onSubmit={turnOff} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="admin-mfa-password">Password (to turn it off)</Label>
              <Input id="admin-mfa-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" variant="outline" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Turn off two-step sign-in
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
