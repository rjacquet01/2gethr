'use client'

import { useState } from 'react'
import { addDays, addMinutes, differenceInCalendarDays, endOfDay, format, formatDistanceToNowStrict, isToday, isTomorrow, parseISO, set } from 'date-fns'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { authFetch } from '@/hooks/use-auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { DictateField } from '@/components/dictate-button'
import { appendDictation } from '@/lib/dictation'

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

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// "Take meds tomorrow 8am daily @Sam", "call mom in 2 hours", "pay rent fri 5pm"
export function parseReminderQuick(raw: string, members: QuickMember[], now: Date = new Date()): QuickParse {
  let text = ' ' + raw.trim() + ' '
  const out: QuickParse = { title: '', at: null, recurrence: 'NONE' }

  text = text.replace(/\s@(\w+)/, (m, n: string) => {
    const hit = members.find((x) => x.userId && x.displayName.toLowerCase().startsWith(n.toLowerCase()))
    if (hit) {
      out.member = hit
      return ' '
    }
    return m
  })

  text = text.replace(/\s(?:every\s+(day|week|month|year)|(daily|weekly|monthly|yearly))\b/i, (_m, a?: string, b?: string) => {
    const w = (a || b || '').toLowerCase()
    out.recurrence = w.startsWith('day') || w === 'daily' ? 'DAILY' : w.startsWith('week') ? 'WEEKLY' : w.startsWith('month') ? 'MONTHLY' : 'YEARLY'
    return ' '
  })

  // Held in an object so TypeScript doesn't narrow these to their initial
  // values (they're assigned inside the replace callbacks below).
  const st = { rel: null as Date | null, day: null as Date | null, tonight: false, hh: null as number | null, mm: 0 }
  text = text.replace(/\sin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|days?|[mhd])\b/i, (_m, n: string, u: string) => {
    const k = parseInt(n, 10)
    const unit = u.toLowerCase()
    if (unit.startsWith('m')) st.rel = addMinutes(now, k)
    else if (unit.startsWith('h')) st.rel = addMinutes(now, k * 60)
    else st.rel = addDays(now, k)
    return ' '
  })

  // Whole weekday names and abbreviations only ("friend" is not Friday).
  text = text.replace(/\s(today|tonight|tomorrow|tmrw|(?:next\s+)?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?))\b/i, (m, d: string) => {
    const w = d.toLowerCase().replace(/^next\s+/, '')
    if (w === 'today') st.day = new Date(now)
    else if (w === 'tonight') {
      st.day = new Date(now)
      st.tonight = true
    } else if (w === 'tomorrow' || w === 'tmrw') st.day = addDays(now, 1)
    else {
      const idx = DAY_NAMES.findIndex((x) => x.startsWith(w.slice(0, 3)))
      if (idx < 0) return m
      st.day = addDays(now, (idx - now.getDay() + 7) % 7 || 7)
    }
    return ' '
  })

  const setTime = (h: number, m: number) => {
    st.hh = h
    st.mm = m
  }
  const t12 = /\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  const t24 = /\s(?:at\s+)?(\d{1,2}):(\d{2})\b/
  const tAt = /\sat\s+(\d{1,2})\b/i
  const tWord = /\s(noon|midnight)\b/i
  if (t12.test(text)) {
    text = text.replace(t12, (_m, h: string, m: string | undefined, ap: string) => {
      let H = parseInt(h, 10) % 12
      if (ap.toLowerCase() === 'pm') H += 12
      setTime(H, m ? parseInt(m, 10) : 0)
      return ' '
    })
  } else if (t24.test(text)) {
    text = text.replace(t24, (_m, h: string, m: string) => {
      setTime(Math.min(23, parseInt(h, 10)), Math.min(59, parseInt(m, 10)))
      return ' '
    })
  } else if (tWord.test(text)) {
    text = text.replace(tWord, (_m, w: string) => {
      setTime(w.toLowerCase() === 'noon' ? 12 : 0, 0)
      return ' '
    })
  } else if (tAt.test(text)) {
    text = text.replace(tAt, (_m, h: string) => {
      const H = parseInt(h, 10)
      // "at 5" is nearly always the evening unless it's 8-11
      setTime(H >= 1 && H <= 7 ? H + 12 : H, 0)
      return ' '
    })
  }

  if (st.rel) {
    out.at = st.rel
  } else if (st.day || st.hh !== null) {
    let at = set(st.day || now, {
      hours: st.hh ?? (st.tonight ? 20 : 9),
      minutes: st.hh !== null ? st.mm : 0,
      seconds: 0,
      milliseconds: 0,
    })
    // Time only ("8am") and it already passed today -> tomorrow
    if (!st.day && at.getTime() <= now.getTime()) at = addDays(at, 1)
    out.at = at
  }

  out.title = text
    .replace(/^\s*remind me\s*(to|about)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(at|on|by|for|in)$/i, '')
    .trim()
  return out
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
