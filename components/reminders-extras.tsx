'use client'

import { useState } from 'react'
import { addDays, differenceInCalendarDays, endOfDay, format, formatDistanceToNowStrict, isToday, isTomorrow, parseISO } from 'date-fns'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { DictateField } from '@/components/dictate-button'
import { appendDictation } from '@/lib/dictation'
import { nextOccurrence, parseWhen, tidyTitle } from '@/lib/when-parser'

/* ----------------------------- Quick parse ----------------------------- */

export interface QuickMember {
  id: string
  userId: string | null
  displayName: string
}

export interface QuickParse {
  title: string
  at: Date | null
  recurrence: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  member?: QuickMember
}

// "Take meds tomorrow 8am daily @Sam", "call mom in 2 hours", "pay rent fri 5pm"
export function parseReminderQuick(raw: string, members: QuickMember[], now: Date = new Date()): QuickParse {
  let text = ' ' + raw.trim() + ' '
  let member: QuickMember | undefined
  text = text.replace(/\s@(\w+)/, (m, n: string) => {
    const hit = members.find((x) => x.userId && x.displayName.toLowerCase().startsWith(n.toLowerCase()))
    if (hit) {
      member = hit
      return ' '
    }
    return m
  })
  const when = parseWhen(text, now)
  // A repeat with no time ("every Saturday") goes off at 9 AM: if that already
  // passed today, the first reminder is the next one.
  const at = when.at && !when.hasTime && when.recurrence !== 'NONE' && when.at.getTime() <= now.getTime()
    ? nextOccurrence(when.at, when.recurrence)
    : when.at
  return {
    title: tidyTitle(when.rest.replace(/^\s*remind me\s*(to|about)?\s*/i, '')),
    at,
    recurrence: when.recurrence,
    member,
  }
}

/* ------------------------------ Quick add ------------------------------ */

const DEFAULT_CHANNELS = ['in_app', 'push', 'email']

export function ReminderQuickAdd({
  members,
  familyId,
  onCreated,
}: {
  members: QuickMember[]
  /** The family being viewed; the reminder is created there. */
  familyId?: string
  onCreated: (reminder: any) => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const parsed = parseReminderQuick(value, members)
  const past = !!parsed.at && parsed.at.getTime() <= Date.now()
  const ready = !!parsed.title && !!parsed.at && !past

  const submit = async () => {
    if (!ready || busy || !parsed.at) return
    setBusy(true)
    try {
      const res = await authFetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: parsed.title,
          remindAt: parsed.at.toISOString(),
          isRecurring: parsed.recurrence !== 'NONE',
          recurrenceRule: parsed.recurrence !== 'NONE' ? parsed.recurrence : null,
          forMemberId: parsed.member?.id,
          familyId,
          notifyChannels: DEFAULT_CHANNELS,
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) throw new Error(j?.error || 'Could not add reminder')
      toast.success('Reminder added')
      setValue('')
      onCreated(j.data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add reminder')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <DictateField className="min-w-0 flex-1" label="Dictate a reminder" onText={(t) => setValue((v) => appendDictation(v, t))}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='Quick add: "Take meds tomorrow 8am daily"'
            className="h-10 pr-11"
            aria-label="Quick add reminder"
          />
        </DictateField>
        <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!ready || busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">Add</span>
        </Button>
      </form>
      {value.trim() && (
        <p className="text-xs text-muted-foreground">
          {!parsed.title ? (
            'Type what to be reminded about'
          ) : !parsed.at ? (
            <>
              “{parsed.title}” · add <span className="font-medium">when</span> — like “tomorrow 8am”, “fri 5pm” or “in 2 hours”
            </>
          ) : past ? (
            <span className="text-destructive">That time has already passed</span>
          ) : (
            <>
              “{parsed.title}” · {format(parsed.at, 'EEE, MMM d · h:mm a')}
              {parsed.recurrence !== 'NONE' && <> · repeats {parsed.recurrence.toLowerCase()}</>}
              {parsed.member && <> · for {parsed.member.displayName}</>}
            </>
          )}
        </p>
      )}
    </div>
  )
}

/* ------------------------------- Grouping ------------------------------- */

export type ReminderGroupKey = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'

export function groupReminders<T extends { remind_at: string }>(list: T[]) {
  const groups: Record<ReminderGroupKey, T[]> = { overdue: [], today: [], tomorrow: [], week: [], later: [] }
  const now = Date.now()
  const weekEnd = endOfDay(addDays(new Date(), 7)).getTime()
  for (const r of list) {
    const d = parseISO(r.remind_at)
    if (d.getTime() < now) groups.overdue.push(r)
    else if (isToday(d)) groups.today.push(r)
    else if (isTomorrow(d)) groups.tomorrow.push(r)
    else if (d.getTime() <= weekEnd) groups.week.push(r)
    else groups.later.push(r)
  }
  const byTime = (a: T, b: T) => a.remind_at.localeCompare(b.remind_at)
  ;(Object.keys(groups) as ReminderGroupKey[]).forEach((k) => groups[k].sort(byTime))
  return groups
}

export function whenText(iso: string) {
  const d = parseISO(iso)
  if (d.getTime() < Date.now()) return `${formatDistanceToNowStrict(d)} ago`
  if (isToday(d)) return `Today ${format(d, 'h:mm a')}`
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'h:mm a')}`
  if (differenceInCalendarDays(d, new Date()) <= 6) return format(d, 'EEE h:mm a')
  return format(d, 'MMM d, h:mm a')
}
