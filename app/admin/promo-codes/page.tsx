'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Copy, Plus, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { planName } from '@/lib/admin-tier-breakdown'
import type { PromoCodeRow } from '@/lib/promo-codes'

const SITE = 'https://mytogethr.com'

const adminFetch = (url: string, init: RequestInit = {}) => {
  const token = getAdminAccessToken()
  return fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
}

const listFetcher = async (url: string) => {
  const res = await adminFetch(url)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Failed to load promo codes')
  return json.data as PromoCodeRow[]
}

const appliesLabel = (v: string) => (v === 'PREMIUM' || v === 'PREMIUM_PLUS' ? `${planName(v)} only` : 'Any plan')

const emptyForm = {
  code: '',
  kind: 'percent' as 'percent' | 'amount',
  value: '',
  duration: 'once' as 'once' | 'repeating' | 'forever',
  months: '3',
  appliesTo: 'ALL' as 'ALL' | 'PREMIUM' | 'PREMIUM_PLUS',
  maxRedemptions: '',
  expiresOn: '',
  firstTimeOnly: true,
}

export default function AdminPromoCodesPage() {
  const { data: codes, error, isLoading, mutate } = useSWR('/api/admin/promo-codes', listFetcher)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const set = <K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function create() {
    setSaving(true)
    try {
      const res = await adminFetch('/api/admin/promo-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          kind: form.kind,
          value: Number(form.value),
          duration: form.duration,
          ...(form.duration === 'repeating' ? { months: Number(form.months) } : {}),
          appliesTo: form.appliesTo,
          ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
          ...(form.expiresOn ? { expiresOn: form.expiresOn } : {}),
          firstTimeOnly: form.firstTimeOnly,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error || 'Could not create the code')
        return
      }
      toast.success(`${json.data.code} created`)
      setOpen(false)
      setForm(emptyForm)
      mutate()
    } finally {
      setSaving(false)
    }
  }

  async function setActive(row: PromoCodeRow, active: boolean) {
    setBusyId(row.id)
    try {
      const res = await adminFetch(`/api/admin/promo-codes/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(json.error || 'Could not update the code')
      else toast.success(`${row.code} ${active ? 'turned on' : 'turned off'}`)
      mutate()
    } finally {
      setBusyId(null)
    }
  }

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(`${SITE}/?promo=${encodeURIComponent(code)}`)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promo Codes</h1>
          <p className="text-muted-foreground">
            Discounts on Plus and Premium, kept in Stripe. People enter a code when they upgrade, or open a link with it.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New code
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <p className="text-sm text-muted-foreground">
            Turning a code off stops new sign-ups using it. Families already on its discount keep it until it runs out.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : !codes || codes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <Tag className="h-8 w-8" />
              <p>No promo codes yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead>Plans</TableHead>
                    <TableHead>Used</TableHead>
                    <TableHead>Ends</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono font-semibold">{row.code}</TableCell>
                      <TableCell>
                        {row.description}
                        {row.firstTimeOnly && <span className="block text-xs text-muted-foreground">First purchase only</span>}
                      </TableCell>
                      <TableCell>{appliesLabel(row.appliesTo)}</TableCell>
                      <TableCell>
                        {row.timesRedeemed}
                        {row.maxRedemptions ? ` / ${row.maxRedemptions}` : ''}
                      </TableCell>
                      <TableCell>{row.expiresAt ? new Date(row.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                      <TableCell>
                        <Badge variant={row.active ? 'default' : 'outline'}>{row.active ? 'Active' : 'Off'}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => copyLink(row.code)} aria-label={`Copy link for ${row.code}`}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => setActive(row, !row.active)}>
                          {row.active ? 'Turn off' : 'Turn on'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New promo code</DialogTitle>
            <DialogDescription>Created in Stripe straight away. The code can&apos;t be edited later; turn it off and make a new one instead.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo-code">Code</Label>
              <Input
                id="promo-code"
                value={form.code}
                onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                placeholder="LAUNCH20"
                maxLength={30}
                className="font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount</Label>
                <Select value={form.kind} onValueChange={(v) => set('kind', v as 'percent' | 'amount')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent off</SelectItem>
                    <SelectItem value="amount">Dollars off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-value">{form.kind === 'percent' ? 'Percent' : 'Dollars'}</Label>
                <Input
                  id="promo-value"
                  type="number"
                  min={form.kind === 'percent' ? 1 : 0.01}
                  max={form.kind === 'percent' ? 100 : undefined}
                  step={form.kind === 'percent' ? 1 : 0.01}
                  value={form.value}
                  onChange={(e) => set('value', e.target.value)}
                  placeholder={form.kind === 'percent' ? '20' : '5.00'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>How long</Label>
                <Select value={form.duration} onValueChange={(v) => set('duration', v as 'once' | 'repeating' | 'forever')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="once">First payment only</SelectItem>
                    <SelectItem value="repeating">A number of months</SelectItem>
                    <SelectItem value="forever">Every payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.duration === 'repeating' && (
                <div className="space-y-1.5">
                  <Label htmlFor="promo-months">Months</Label>
                  <Input id="promo-months" type="number" min={1} max={36} value={form.months} onChange={(e) => set('months', e.target.value)} />
                </div>
              )}
            </div>
            {form.duration === 'once' && (
              <p className="-mt-2 text-xs text-muted-foreground">On an annual plan the first payment is the whole year.</p>
            )}

            <div className="space-y-1.5">
              <Label>Plans</Label>
              <Select value={form.appliesTo} onValueChange={(v) => set('appliesTo', v as 'ALL' | 'PREMIUM' | 'PREMIUM_PLUS')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Any plan</SelectItem>
                  <SelectItem value="PREMIUM">{planName('PREMIUM')} only</SelectItem>
                  <SelectItem value="PREMIUM_PLUS">{planName('PREMIUM_PLUS')} only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-max">Max uses (optional)</Label>
                <Input id="promo-max" type="number" min={1} value={form.maxRedemptions} onChange={(e) => set('maxRedemptions', e.target.value)} placeholder="No limit" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-ends">Last day (optional)</Label>
                <Input id="promo-ends" type="date" value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.firstTimeOnly} onCheckedChange={(v) => set('firstTimeOnly', v === true)} />
              New paying customers only (not families who have paid before)
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving || !form.code || !form.value}>
              {saving ? 'Creating...' : 'Create code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
