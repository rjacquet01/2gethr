'use client'

import { useState, useSyncExternalStore } from 'react'
import { addDays, differenceInCalendarDays, endOfDay, format, isPast, isToday, isTomorrow, parseISO } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Plus, UserPlus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DictateField } from '@/components/dictate-button'
import { appendDictation } from '@/lib/dictation'
import { parseWhen, tidyTitle, type Recurrence } from '@/lib/when-parser'
import { toast } from 'sonner'
import { createTask } from '@/hooks/use-tasks'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { ACTIVE_TASK_STATUSES, isTaskOverdue, normTaskStatus } from '@/lib/task-due'
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
  /** Family role ('PARENT', 'CHILD', 'GUEST', ...); child profiles are 'CHILD'. */
  role?: string
}

const ROLE_LABEL: Record<string, string> = { PARENT: 'Parent', GUARDIAN: 'Guardian', ADULT: 'Adult', CHILD: 'Child', GUEST: 'Guest' }

/** The "Unassigned" bubble on a task: tap to hand the task to someone. */
export function AssigneePicker({
  options,
  meId,
  disabled,
  onPick,
}: {
  options: Person[]
  meId?: string
  disabled?: boolean
  onPick: (p: Person) => void
}) {
  const me = options.find((p) => p.userId && p.userId === meId)
  const others = options.filter((p) => p !== me)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Unassigned. Choose who does this task"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/5 py-1 pl-1 pr-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
            <UserPlus className="h-3 w-3" />
          </span>
          Unassigned
          <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-60 max-w-[calc(100vw-1.5rem)] overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Assign to</DropdownMenuLabel>
        {me && <PersonItem p={me} label="Me" onPick={onPick} />}
        {me && others.length > 0 && <DropdownMenuSeparator />}
        {others.map((p) => (
          <PersonItem key={p.key} p={p} onPick={onPick} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PersonItem({ p, label, onPick }: { p: Person; label?: string; onPick: (p: Person) => void }) {
  return (
    <DropdownMenuItem onSelect={() => onPick(p)} className="min-h-11 gap-2">
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
        style={{ backgroundColor: p.color || '#6366f1' }}
        aria-hidden="true"
      >
        {initialsOf(p.name)}
      </span>
      <span className="min-w-0 flex-1 truncate">{label ?? p.name}</span>
      {p.role && ROLE_LABEL[p.role] && <span className="shrink-0 text-[11px] text-muted-foreground">{ROLE_LABEL[p.role]}</span>}
    </DropdownMenuItem>
  )
}

export function initialsOf(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'
}

/* ----------------------------- Quick add ----------------------------- */

// Task repeat values (the task form's frequencies); tasks have no yearly repeat.
const TASK_REPEAT: Partial<Record<Recurrence, string>> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }

type QuickParsed = { title: string; person?: Person; due?: Date; priority?: string; repeat?: string }

/**
 * `keepTitle`: a title picked from the suggestions. While the input still
 * starts with it, it is kept word for word and only what follows is parsed
 * ("Pack your school bag for tomorrow" keeps its "tomorrow").
 */
export function parseQuickAdd(raw: string, people: Person[], keepTitle?: string, now: Date = new Date()): QuickParsed {
  const start = raw.trimStart()
  if (keepTitle && start.startsWith(keepTitle)) {
    const rest = parseQuickAdd(start.slice(keepTitle.length), people, undefined, now)
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
  const when = parseWhen(text, now)
  // A day alone is due by the end of it; a time is due then.
  if (when.at) out.due = when.hasTime ? when.at : endOfDay(when.at)
  const repeat = TASK_REPEAT[when.recurrence]
  if (repeat) out.repeat = repeat
  out.title = tidyTitle(when.rest)
  return out
}

const CATEGORY_KEY = 'togethr.quickAdd.category'
const NOBODY = '__nobody'

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
  // Who the task is for, from the "Assign to" menu; NOBODY falls back to an @name in the text.
  const [assignee, setAssignee] = useState(NOBODY)

  const categories = suggestionCategories(hasChildren)
  const saved = useSyncExternalStore(noSubscribe, readSavedCategory, () => null)
  const category = chosen ?? saved ?? 'home'
  const activeCategory = categories.includes(category) ? category : categories[0]
  const categoryIndex = categories.indexOf(activeCategory)
  // The arrows in the menu header rotate through the categories (and wrap).
  const rotate = (step: number) => {
    const c = categories[(categoryIndex + step + categories.length) % categories.length]
    setCategory(c)
    try {
      localStorage.setItem(CATEGORY_KEY, c)
    } catch {}
  }

  // A picked suggestion stays word for word while the input starts with it.
  const pickedNow = picked && value.trimStart().startsWith(picked.title) ? picked : null
  const parsed = parseQuickAdd(value, people, pickedNow?.title)
  const person = people.find((p) => p.key === assignee) ?? parsed.person
  const inCategory = filterSuggestions({ category: activeCategory, hasChildren, openTitles })
  // Typed text (not a picked suggestion): matches from every category first.
  // (raw text when it parses to nothing: "sun" alone is Sunday, but should find sunscreen)
  const query = pickedNow ? '' : parsed.title || value.trim()
  const matches = query ? filterSuggestions({ category: activeCategory, query, hasChildren, openTitles }) : []

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
        assignedToUserId: person?.userId,
        assignedToChildId: person?.userId ? undefined : person?.childId,
        dueDate: parsed.due ? parsed.due.toISOString() : undefined,
        ...(parsed.repeat ? { isRecurring: true, recurrenceRule: parsed.repeat } : {}),
        priority: parsed.priority,
      })
      toast.success(person ? `Task added for ${person.name.split(' ')[0]}` : 'Task added')
      setValue('')
      setPicked(null)
      setAssignee(NOBODY)
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
        <DictateField className="min-w-0 flex-1" label="Dictate a task" onText={(t) => setValue((v) => appendDictation(v, t))}>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder='Quick add: "Pack lunches @Bob tomorrow !high"'
            className="h-10 pr-11"
            aria-label="Quick add task"
          />
        </DictateField>
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
              {person && <> · for {person.name}</>}
              {parsed.due && (
                <> · due {format(parsed.due, isEndOfDay(parsed.due) ? 'EEE, MMM d' : 'EEE, MMM d · h:mm a')}</>
              )}
              {parsed.repeat && <> · repeats {parsed.repeat}</>}
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

      <div className="flex flex-wrap items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-11 gap-1.5">
              <Lightbulb className="h-4 w-4 text-accent" aria-hidden="true" />
              Suggestions
              {matches.length > 0 && (
                <span className="rounded-full bg-accent/15 px-1.5 text-xs font-semibold text-foreground">{matches.length}</span>
              )}
              <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-80 max-w-[calc(100vw-1.5rem)] p-0"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                rotate(e.key === 'ArrowLeft' ? -1 : 1)
              }
            }}
          >
            {matches.length > 0 && (
              <div className="border-b p-1">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Matching “{query}”</DropdownMenuLabel>
                {matches.map((s) => (
                  <SuggestionItem key={s.title} s={s} onPick={pick} />
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-1 border-b px-1 py-1">
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Previous category" onClick={() => rotate(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 text-center" aria-live="polite">
                <p className="truncate text-sm font-semibold">{SUGGESTION_CATEGORY_LABELS[activeCategory]}</p>
                <p className="text-[11px] text-muted-foreground">
                  {categoryIndex + 1} of {categories.length}
                </p>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label="Next category" onClick={() => rotate(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1">
              {inCategory.map((s) => (
                <SuggestionItem key={s.title} s={s} onPick={pick} />
              ))}
              {inCategory.length === 0 && (
                <p className="px-2 py-3 text-center text-sm text-muted-foreground">These are all on your list already.</p>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="h-11 w-auto min-w-36 max-w-full" aria-label="Assign to">
            <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NOBODY}>{parsed.person ? `@${parsed.person.name.split(' ')[0]}` : 'Assign to…'}</SelectItem>
            {people.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function SuggestionItem({ s, onPick }: { s: QuickAddSuggestion; onPick: (s: QuickAddSuggestion) => void }) {
  return (
    <DropdownMenuItem onSelect={() => onPick(s)} className="min-h-11 items-start gap-2 whitespace-normal">
      <span className="flex-1">{s.title}</span>
      {s.due && <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{dueHint(s.due)}</span>}
    </DropdownMenuItem>
  )
}

/* ------------------------------ Grouping ------------------------------ */

export const ACTIVE = ACTIVE_TASK_STATUSES
// An approved task (parent signed off) is a finished task.
export const norm = normTaskStatus

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
    if (isTaskOverdue(t)) groups.overdue.push(t)
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

const isEndOfDay = (d: Date) => d.getHours() === 23 && d.getMinutes() === 59
