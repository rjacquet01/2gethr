'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { addDays, differenceInCalendarDays, endOfDay, format, isPast, isToday, isTomorrow, parseISO } from 'date-fns'
import { Plus, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { createTask } from '@/hooks/use-tasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_CATEGORY_LABELS,
  dueHint,
  filterSuggestions,
  suggestedTokens,
  suggestionCategories,
  type QuickAddSuggestion,
  type SuggestionCategory,
} from '@/lib/quick-add-suggestions'

/* ------------------------------ People ------------------------------ */

export interface Person {
  key: string
  name: string
  userId?: string
  childId?: string
  color?: string | null
}

export function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
}

/* ----------------------------- Quick add ----------------------------- */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Whole weekday names and their usual abbreviations only, so "friend",
// "monthly" or "sunscreen" stay in the title.
const DAY_WORD =
  /\s(today|tonight|tomorrow|tmrw|(?:next\s+)?(?:sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?))\b/i

type QuickParsed = { title: string; person?: Person; due?: Date; priority?: string }

/**
 * `keepTitle`: a title picked from the suggestions. While the input still
 * starts with it, it is kept word for word and only what follows is parsed
 * ("Pack your school bag for tomorrow" keeps its "tomorrow").
 */
export function parseQuickAdd(raw: string, people: Person[], keepTitle?: string): QuickParsed {
  const start = raw.trimStart()
  if (keepTitle && start.startsWith(keepTitle)) {
    const rest = parseQuickAdd(start.slice(keepTitle.length), people)
    return { ...rest, title: (keepTitle + ' ' + rest.title).trim() }
  }
  const out: QuickParsed = { title: '' }
  let text = ' ' + raw.trim() + ' '

  text = text.replace(/\s@(\w+)/g, (m, n: string) => {
    const hit = people.find((p) => p.name.toLowerCase().startsWith(n.toLowerCase()))
    if (hit && !out.person) {
      out.person = hit
      return ' '
    }
    return m
  })
  text = text.replace(/\s!(urgent|high|medium|low)\b/gi, (_m, p: string) => {
    out.priority = p.toLowerCase()
    return ' '
  })
  text = text.replace(DAY_WORD, (_m, d: string) => {
    const now = new Date()
    const w = d.toLowerCase().replace(/^next\s+/, '')
    let target = new Date(now)
    if (w === 'tomorrow' || w === 'tmrw') target = addDays(now, 1)
    else if (w !== 'today' && w !== 'tonight') {
      const idx = DAYS.findIndex((x) => x.startsWith(w.slice(0, 3)))
      if (idx < 0) return _m
      const diff = (idx - now.getDay() + 7) % 7 || 7
      target = addDays(now, diff)
    }
    out.due = endOfDay(target)
    return ' '
  })
  out.title = text.replace(/\s+/g, ' ').trim()
  return out
}

const CATEGORY_KEY = 'togethr.quickAdd.category'
const SHOWN = 6

const noSubscribe = () => () => {}
function readSavedCategory(): SuggestionCategory | null {
  try {
    const v = localStorage.getItem(CATEGORY_KEY) as SuggestionCategory | null
    return v && SUGGESTION_CATEGORIES.includes(v) ? v : null
  } catch {
    return null
  }
}

export function QuickAdd({
  familyId,
  people,
  onCreated,
  openTitles = [],
  hasChildren = false,
}: {
  familyId: string
  people: Person[]
  onCreated: () => void
  /** Titles of the family's open tasks, so they aren't suggested again. */
  openTitles?: string[]
  hasChildren?: boolean
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<QuickAddSuggestion | null>(null)
  const [timingUsed, setTimingUsed] = useState(false)
  const [chosen, setCategory] = useState<SuggestionCategory | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [offset, setOffset] = useState(0)

  const categories = suggestionCategories(hasChildren)
  const saved = useSyncExternalStore(noSubscribe, readSavedCategory, () => null)
  const category = chosen ?? saved ?? 'home'
  const activeCategory = categories.includes(category) ? category : categories[0]
  // Keep the selected pill in view when it sits past the edge of the row.
  const pillsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = pillsRef.current
    const pill = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (row && pill && (pill.offsetLeft < row.scrollLeft || pill.offsetLeft + pill.offsetWidth > row.scrollLeft + row.clientWidth)) {
      row.scrollLeft = pill.offsetLeft - 8
    }
  }, [activeCategory])
  const chooseCategory = (c: SuggestionCategory) => {
    setCategory(c)
    setShowAll(false)
    setOffset(0)
    try {
      localStorage.setItem(CATEGORY_KEY, c)
    } catch {}
  }

  // A picked suggestion stays word for word while the input starts with it.
  const pickedNow = picked && value.trimStart().startsWith(picked.title) ? picked : null
  const parsed = parseQuickAdd(value, people, pickedNow?.title)
  const typing = value.trim() !== ''
  const matches = filterSuggestions({
    category: activeCategory,
    query: typing ? parsed.title : '',
    hasChildren,
    openTitles,
  })
  const visible =
    typing || showAll || matches.length <= SHOWN
      ? matches
      : Array.from({ length: SHOWN }, (_, i) => matches[(offset + i) % matches.length])

  const pick = (s: QuickAddSuggestion) => {
    setPicked(s)
    setTimingUsed(false)
    setValue(s.title)
  }
  const useTiming = () => {
    if (!pickedNow) return
    const tokens = suggestedTokens(pickedNow)
    setValue((v) => `${v.trimEnd()} ${tokens}`)
    setTimingUsed(true)
  }

  const submit = async () => {
    if (!parsed.title || busy) return
    setBusy(true)
    try {
      await createTask({
        familyId,
        title: parsed.title,
        assignedToUserId: parsed.person?.userId,
        assignedToChildId: parsed.person?.userId ? undefined : parsed.person?.childId,
        dueDate: parsed.due ? parsed.due.toISOString() : undefined,
        priority: parsed.priority,
      })
      toast.success('Task added')
      setValue('')
      setPicked(null)
      onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add task')
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
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Quick add: "Pack lunches @Bob tomorrow !high"'
          className="h-10"
          aria-label="Quick add task"
        />
        <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!parsed.title || busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="ml-1 hidden sm:inline">Add</span>
        </Button>
      </form>
      {value.trim() && (
        <p className="text-xs text-muted-foreground">
          {parsed.title ? (
            <>
              “{parsed.title}”
              {parsed.person && <> · for {parsed.person.name}</>}
              {parsed.due && <> · due {format(parsed.due, 'EEE, MMM d')}</>}
              {parsed.priority && <> · {parsed.priority} priority</>}
            </>
          ) : (
            'Type a task title'
          )}
        </p>
      )}
      {pickedNow?.due && !timingUsed && (
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>suggested: {dueHint(pickedNow.due)}</span>
          <Button type="button" variant="link" size="sm" className="h-11 px-0 text-xs" onClick={useTiming}>
            Use suggested timing
          </Button>
        </div>
      )}

      {!pickedNow && (!typing || visible.length > 0) && (
        <div className="space-y-2 pt-1" role="group" aria-label="Suggestions">
          <p className="text-xs font-medium text-muted-foreground">Suggestions</p>
          {!typing && (
            <div ref={pillsRef} className="relative -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === activeCategory}
                  onClick={() => chooseCategory(c)}
                  className={cn(
                    'min-h-11 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors',
                    c === activeCategory
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  )}
                >
                  {SUGGESTION_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          )}
          <ul role="list" className="flex flex-wrap gap-2">
            {visible.map((s) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  aria-label={`Use suggestion: ${s.title}`}
                  className="min-h-11 rounded-full border border-dashed border-border bg-muted/40 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
          {!typing && matches.length > SHOWN && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 text-xs"
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? 'Fewer' : `More (${matches.length - SHOWN})`}
              </Button>
              {!showAll && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 w-11 p-0"
                  aria-label="Show different suggestions"
                  onClick={() => setOffset((o) => (o + SHOWN) % matches.length)}
                >
                  <Shuffle className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------ Grouping ------------------------------ */

export const ACTIVE = ['pending', 'in_progress', 'pending_approval']
// An approved task (parent signed off) is a finished task.
export const norm = (s?: string | null) => {
  const v = (s || '').toLowerCase()
  return v === 'approved' ? 'completed' : v
}

export type GroupKey = 'overdue' | 'today' | 'week' | 'later' | 'nodate' | 'closed'

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export function groupTasks<T extends { status: string; priority: string; due_date: string | null }>(tasks: T[]) {
  const groups: Record<GroupKey, T[]> = { overdue: [], today: [], week: [], later: [], nodate: [], closed: [] }
  const weekEnd = endOfDay(addDays(new Date(), 7))
  for (const t of tasks) {
    if (!ACTIVE.includes(norm(t.status))) {
      groups.closed.push(t)
      continue
    }
    if (!t.due_date) {
      groups.nodate.push(t)
      continue
    }
    const d = parseISO(t.due_date)
    if (isPast(d)) groups.overdue.push(t)
    else if (isToday(d)) groups.today.push(t)
    else if (d <= weekEnd) groups.week.push(t)
    else groups.later.push(t)
  }
  const byDue = (a: T, b: T) =>
    (PRIORITY_RANK[norm(a.priority)] ?? 2) - (PRIORITY_RANK[norm(b.priority)] ?? 2) ||
    (a.due_date ? parseISO(a.due_date).getTime() : 0) - (b.due_date ? parseISO(b.due_date).getTime() : 0)
  ;(Object.keys(groups) as GroupKey[]).forEach((k) => groups[k].sort(byDue))
  return groups
}

export function dueText(due: string | null) {
  if (!due) return ''
  const d = parseISO(due)
  const days = differenceInCalendarDays(new Date(), d)
  if (isPast(d) && !isToday(d)) return days === 1 ? 'Yesterday · overdue' : `${days} days overdue`
  if (isToday(d)) return isPast(d) ? 'Due earlier today' : `Today ${format(d, 'h:mm a')}`
  if (isTomorrow(d)) return 'Tomorrow'
  if (differenceInCalendarDays(d, new Date()) <= 6) return format(d, 'EEE, MMM d')
  return format(d, 'MMM d')
}

export const OUTDOOR = /\b(yard|lawn|mow|garden|walk|dog|groceries|grocery|errand|store|shopping|pick ?up|drop ?off|trash|garbage|car wash|wash the car|bike|park|practice|game|soccer)\b/i

/* ---------------------------- Person progress ---------------------------- */

export function PersonProgress({
  people,
  tasks,
}: {
  people: Person[]
  tasks: Array<{
    status: string
    assigned_to_id: string | null
    child_profile_id: string | null
    completed_at: string | null
  }>
}) {
  const weekAgo = addDays(new Date(), -7)
  const rows = people
    .map((p) => {
      const mine = tasks.filter(
        (t) => (p.userId && t.assigned_to_id === p.userId) || (p.childId && t.child_profile_id === p.childId)
      )
      const done = mine.filter(
        (t) => norm(t.status) === 'completed' && t.completed_at && parseISO(t.completed_at) >= weekAgo
      ).length
      const open = mine.filter((t) => ACTIVE.includes(norm(t.status))).length
      return { p, done, open }
    })
    .filter((r) => r.done + r.open > 0)
  if (rows.length === 0) return null
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {rows.map(({ p, done, open }) => {
        const pct = Math.round((done / (done + open)) * 100)
        return (
          <div key={p.key} className="min-w-36 shrink-0 rounded-lg border bg-card px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white')}
                style={{ backgroundColor: p.color || '#6366f1' }}
              >
                {initialsOf(p.name)}
              </span>
              <span className="truncate text-sm font-medium">{p.name.split(' ')[0]}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-green-500" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {done} done this week · {open} open
            </p>
          </div>
        )
      })}
    </div>
  )
}
