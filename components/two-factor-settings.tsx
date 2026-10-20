'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { TotpQr } from '@/components/totp-qr'

type Step = 'closed' | 'qr' | 'confirm' | 'backupCodes' | 'disable'

/**
 * Self-contained enable/disable flow for TOTP-based two-factor auth.
 * Replaces the previous dead "Enable 2FA" button in Settings > Security,
 * which had no onClick and no backend behind it at all.
 */
export function TwoFactorSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [step, setStep] = useState<Step>('closed')
  const [isLoading, setIsLoading] = useState(false)

  const [otpAuthUrl, setOtpAuthUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [password, setPassword] = useState('')

  useEffect(() => {
    authFetch('/api/auth/2fa/status')
      .then((res) => res.json())
      .then((data) => setEnabled(!!data?.data?.enabled))
      .catch(() => setEnabled(false))
  }, [])

  const startEnroll = async () => {
    setIsLoading(true)
    try {
      const res = await authFetch('/api/auth/2fa/setup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to start 2FA setup')
        return
      }
      setOtpAuthUrl(data.data.otpAuthUrl)
      setSecret(data.data.secret)
      setStep('qr')
    } catch {
      toast.error('Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const res = await authFetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Invalid code')
        return
      }
      setBackupCodes(data.data.backupCodes)
      setStep('backupCodes')
      setEnabled(true)
      setCode('')
    } catch {
      toast.error('Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const disable = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    try {
      const res = await authFetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to disable 2FA')
        return
      }
      toast.success('Two-factor authentication disabled')
      setEnabled(false)
      setStep('closed')
      setPassword('')
    } catch {
      toast.error('Network error')
    } finally {
      setIsLoading(false)
    }
  }

  const close = () => {
    setStep('closed')
    setCode('')
    setPassword('')
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <Label>Two-Factor Authentication</Label>
          <p className="text-sm text-muted-foreground">
            {enabled ? 'Enabled — your account requires a code at sign-in' : 'Add an extra layer of security'}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={enabled === null}
          onClick={() => (enabled ? setStep('disable') : startEnroll())}
        >
          {enabled ? 'Disable 2FA' : 'Enable 2FA'}
        </Button>
      </div>

      <Dialog open={step === 'qr' || step === 'confirm'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up two-factor authentication</DialogTitle>
            <DialogDescription>
              Add Togethr to an authenticator app (Google Authenticator, Authy, 1Password, etc.), then enter the 6-digit code it shows.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-2">
            {otpAuthUrl && <TotpQr otpAuthUrl={otpAuthUrl} />}
            {otpAuthUrl && (
              // Opens Google Authenticator, Authy, 1Password etc. on this phone.
              <Button asChild variant="outline">
                <a href={otpAuthUrl}>Add to authenticator app</a>
              </Button>
            )}
            <p className="text-xs text-muted-foreground">Scan this with your authenticator app, or enter the key below.</p>
            <code className="text-sm font-mono bg-muted px-3 py-1.5 rounded select-all">{secret}</code>
          </div>
          <form onSubmit={confirmEnroll} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="enroll-code">6-digit code</Label>
              <Input
                id="enroll-code"
                inputMode="numeric"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoFocus
                className="text-center text-lg tracking-widest"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? <Spinner className="w-4 h-4" /> : 'Verify & enable'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={step === 'backupCodes'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your backup codes</DialogTitle>
            <DialogDescription>
              Two-factor authentication is now enabled. Save these one-time backup codes somewhere safe —
              each one can be used once to sign in if you lose access to your authenticator app. They won't be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {backupCodes.map((c) => (
              <code key={c} className="text-sm font-mono bg-muted px-2 py-1.5 rounded text-center select-all">
                {c}
              </code>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={close} className="w-full">I've saved my backup codes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={step === 'disable'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>
              Enter your password to confirm. Your account will no longer require a code at sign-in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={disable} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="disable-password">Password</Label>
              <Input
                id="disable-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={isLoading} className="w-full">
                {isLoading ? <Spinner className="w-4 h-4" /> : 'Disable 2FA'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
