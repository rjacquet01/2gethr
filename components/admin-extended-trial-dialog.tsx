'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { planName } from '@/lib/admin-tier-breakdown'

// Admin > Families and Admin > Subscriptions: grant or cancel an extended
// trial (POST/DELETE /api/admin/subscriptions/extended-trial).

const PRESETS = [14, 30, 60, 90]
const MAX_DAYS = 365
const NOTE_MAX = 200

export interface ExtendedTrialTarget {
  familyId: string
  familyName: string
  tier: string | null
  status: string | null
  trialEndsAt: string | null
  trialSource: string | null
  stripeBilled: boolean
}

export type ExtendedTrialMode = 'grant' | 'revoke'

/** An admin-granted trial that hasn't ended. */
export function hasActiveExtendedTrial(t: ExtendedTrialTarget): boolean {
  return t.trialSource === 'ADMIN_EXTENDED' && t.status === 'TRIALING' && !t.stripeBilled &&
    !!t.trialEndsAt && new Date(t.trialEndsAt).getTime() > Date.now()
}

/** Why a grant isn't offered (a paying family), or null when it is. */
export function extendedTrialBlockedReason(t: ExtendedTrialTarget): string | null {
  if (t.stripeBilled) return 'Paying through Stripe'
  if (t.status === 'ACTIVE' && t.tier && t.tier !== 'FREE') return `On a paid ${planName(t.tier)} plan`
  return null
}

const longDate = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

interface DialogProps {
  target: ExtendedTrialTarget | null
  mode: ExtendedTrialMode
  onClose: () => void
  onDone: () => void
}

export function ExtendedTrialDialog({ target, mode, onClose, onDone }: DialogProps) {
  // The form mounts each time the dialog opens, so it starts blank.
  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        {target && <ExtendedTrialForm target={target} mode={mode} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  )
}

function ExtendedTrialForm({ target, mode, onClose, onDone }: DialogProps & { target: ExtendedTrialTarget }) {
  const [tier, setTier] = useState<'PREMIUM' | 'PREMIUM_PLUS'>('PREMIUM')
  const [preset, setPreset] = useState<string>('14')
  const [customDays, setCustomDays] = useState('')
  const [note, setNote] = useState('')
  const [replace, setReplace] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openedAt] = useState(() => Date.now())

  const days = preset === 'custom' ? Number(customDays) : Number(preset)
  const daysValid = Number.isInteger(days) && days >= 1 && days <= MAX_DAYS
  const endsAt = daysValid ? new Date(openedAt + days * 24 * 60 * 60 * 1000) : null
  const current = hasActiveExtendedTrial(target) ? target : null

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/subscriptions/extended-trial', {
        method: mode === 'grant' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(
          mode === 'grant'
            ? { familyId: target.familyId, tier, days, note: note.trim() || undefined, replace }
            : { familyId: target.familyId, note: note.trim() || undefined }
        ),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || (mode === 'grant' ? 'Failed to grant extended trial' : 'Failed to cancel extended trial'))
        return
      }
      toast.success(data?.message || 'Done')
      onDone()
      onClose()
    } catch {
      setError('An error occurred')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{mode === 'grant' ? 'Grant extended trial' : 'Cancel extended trial'}</DialogTitle>
        <DialogDescription>
          {mode === 'grant'
            ? 'A free trial of a paid plan, regardless of the one-trial-a-year rule. Nothing goes through Stripe.'
            : 'The family goes back to Free right away. Nothing goes through Stripe.'}
        </DialogDescription>
      </DialogHeader>

      {mode === 'grant' && (
        <div className="space-y-4">
          {current && (
            <p className="rounded-md bg-muted p-2 text-sm">
              Current extended trial: {planName(current.tier)} until {longDate(new Date(current.trialEndsAt!))}.
            </p>
          )}
          <div className="space-y-2">
            <Label>Plan</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as 'PREMIUM' | 'PREMIUM_PLUS')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PREMIUM">{planName('PREMIUM')}</SelectItem>
                <SelectItem value="PREMIUM_PLUS">{planName('PREMIUM_PLUS')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Length</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={preset === String(n) ? 'default' : 'outline'}
                  onClick={() => setPreset(String(n))}
                >
                  {n} days
                </Button>
              ))}
              <Button type="button" size="sm" variant={preset === 'custom' ? 'default' : 'outline'} onClick={() => setPreset('custom')}>
                Custom
              </Button>
            </div>
            {preset === 'custom' && (
              <Input
                type="number"
                min={1}
                max={MAX_DAYS}
                step={1}
                placeholder={`Days (1-${MAX_DAYS})`}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                aria-label="Custom days"
              />
            )}
            {preset === 'custom' && customDays !== '' && !daysValid && (
              <p className="text-sm text-destructive">Enter a whole number of days from 1 to {MAX_DAYS}.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="extended-trial-note">Note (optional)</Label>
            <Textarea
              id="extended-trial-note"
              maxLength={NOTE_MAX}
              placeholder="e.g. Play closed-test tester"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{note.length}/{NOTE_MAX}</p>
          </div>
          {current && (
            <div className="flex items-center gap-2">
              <Checkbox id="extended-trial-replace" checked={replace} onCheckedChange={(v) => setReplace(v === true)} />
              <Label htmlFor="extended-trial-replace" className="font-normal">
                Replace the current trial even if it ends later
              </Label>
            </div>
          )}
          {endsAt && (
            <p className="text-sm font-medium" data-testid="extended-trial-summary">
              {target.familyName} will get {planName(tier)} free until {longDate(endsAt)}. No card is charged.
            </p>
          )}
        </div>
      )}

      {mode === 'revoke' && (
        <div className="space-y-4">
          <p className="text-sm">
            {target.familyName} will move from {planName(target.tier)} to Free now
            {target.trialEndsAt ? ` instead of on ${longDate(new Date(target.trialEndsAt))}` : ''}.
          </p>
          <div className="space-y-2">
            <Label htmlFor="extended-trial-revoke-note">Note (optional)</Label>
            <Textarea
              id="extended-trial-revoke-note"
              maxLength={NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button
          variant={mode === 'revoke' ? 'destructive' : 'default'}
          onClick={submit}
          disabled={saving || (mode === 'grant' && !daysValid)}
        >
          {saving ? 'Saving...' : mode === 'grant' ? 'Confirm' : 'Cancel extended trial'}
        </Button>
      </DialogFooter>
    </>
  )
}
