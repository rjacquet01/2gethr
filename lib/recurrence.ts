// Expands a recurrence rule into concrete occurrence start/end instants.
//
// Occurrences are generated on the LOCAL calendar of the event creator
// (IANA time zone) and converted back to UTC, so "every Tuesday at 6pm"
// stays at 6pm local time across daylight saving changes instead of
// drifting by an hour.

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface RecurrenceInput {
  frequency: RecurrenceFrequency
  interval: number
  daysOfWeek?: number[] // 0 = Sunday .. 6 = Saturday (WEEKLY only)
  endDate?: string // ISO instant; no occurrence may start after it
  occurrenceCount?: number // total occurrences, including the first
}

export interface Occurrences {
  starts: string[]
  ends: string[]
  /** true when we stopped at the safety cap before the rule's natural end */
  truncated: boolean
}

// Hard safety cap on how many rows one recurring event can create.
export const MAX_OCCURRENCES = 366
// With no end date and no count, generate this far ahead.
const DEFAULT_HORIZON_DAYS = 365

const DAY_MS = 86_400_000

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface Parts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
}

function getParts(date: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const out: Record<string, number> = {}
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return { y: out.year, mo: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second }
}

function tzOffsetMs(date: Date, tz: string): number {
  const p = getParts(date, tz)
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
  const wholeSecond = Math.floor(date.getTime() / 1000) * 1000
  return asUtc - wholeSecond
}

function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const offset1 = tzOffsetMs(new Date(guess), tz)
  let utc = guess - offset1
  const offset2 = tzOffsetMs(new Date(utc), tz)
  if (offset2 !== offset1) utc = guess - offset2
  return new Date(utc)
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

export function generateOccurrences(
  startIso: string,
  endIso: string,
  rule: RecurrenceInput,
  timeZone: string
): Occurrences {
  const start = new Date(startIso)
  const durationMs = new Date(endIso).getTime() - start.getTime()
  const interval = Math.max(1, rule.interval || 1)
  const p = getParts(start, timeZone)
  const startDayNum = Math.floor(Date.UTC(p.y, p.mo - 1, p.d) / DAY_MS)
  const startWeekday = new Date(startDayNum * DAY_MS).getUTCDay()

  const countLimit = rule.occurrenceCount && rule.occurrenceCount > 0 ? rule.occurrenceCount : null
  const hardEnd = rule.endDate ? new Date(rule.endDate).getTime() : null
  const horizon =
    !countLimit && hardEnd === null ? start.getTime() + DEFAULT_HORIZON_DAYS * DAY_MS : null

  const starts: string[] = []
  const ends: string[] = []
  let truncated = false

  // Returns false once generation should stop.
  const push = (y: number, mo: number, d: number): boolean => {
    const occ = zonedToUtc(y, mo, d, p.h, p.mi, p.s, timeZone)
    const t = occ.getTime()
    if (t < start.getTime()) return true // before the first occurrence; skip
    if (hardEnd !== null && t > hardEnd) return false
    if (horizon !== null && t > horizon) return false
    if (starts.length >= MAX_OCCURRENCES) {
      truncated = true
      return false
    }
    starts.push(occ.toISOString())
    ends.push(new Date(t + durationMs).toISOString())
    if (countLimit && starts.length >= countLimit) return false
    return true
  }

  const fromDayNum = (dayNum: number) => {
    const dt = new Date(dayNum * DAY_MS)
    return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
  }

  const GUARD = 20000
  if (rule.frequency === 'DAILY') {
    for (let k = 0; k < GUARD; k++) {
      const { y, mo, d } = fromDayNum(startDayNum + k * interval)
      if (!push(y, mo, d)) break
    }
  } else if (rule.frequency === 'WEEKLY') {
    const days = Array.from(
      new Set((rule.daysOfWeek && rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [startWeekday]).filter(
        (n) => Number.isInteger(n) && n >= 0 && n <= 6
      ))
    ).sort((a, b) => a - b)
    const weekAnchor = startDayNum - startWeekday // the Sunday of the start week
    let done = false
    for (let w = 0; w < GUARD && !done; w++) {
      for (const dow of days) {
        const dayNum = weekAnchor + w * 7 * interval + dow
        if (dayNum < startDayNum) continue
        const { y, mo, d } = fromDayNum(dayNum)
        if (!push(y, mo, d)) {
          done = true
          break
        }
      }
    }
  } else if (rule.frequency === 'MONTHLY') {
    for (let k = 0; k < GUARD; k++) {
      const idx = p.mo - 1 + k * interval
      const y = p.y + Math.floor(idx / 12)
      const mo = (idx % 12) + 1
      const d = Math.min(p.d, daysInMonth(y, mo))
      if (!push(y, mo, d)) break
    }
  } else {
    for (let k = 0; k < GUARD; k++) {
      const y = p.y + k * interval
      const d = Math.min(p.d, daysInMonth(y, p.mo))
      if (!push(y, p.mo, d)) break
    }
  }

  if (starts.length === 0) {
    // Defensive: always return at least the original instant.
    starts.push(start.toISOString())
    ends.push(new Date(start.getTime() + durationMs).toISOString())
  }
  return { starts, ends, truncated }
}

// Maps the older preset strings the event form used to send
// ("weekly", "biweekly", "weekdays", ...) to a RecurrenceInput.
export function recurrenceFromPreset(preset: string): RecurrenceInput | null {
  switch (preset.toLowerCase()) {
    case 'daily':
      return { frequency: 'DAILY', interval: 1 }
    case 'weekly':
      return { frequency: 'WEEKLY', interval: 1 }
    case 'biweekly':
      return { frequency: 'WEEKLY', interval: 2 }
    case 'monthly':
      return { frequency: 'MONTHLY', interval: 1 }
    case 'yearly':
      return { frequency: 'YEARLY', interval: 1 }
    case 'weekdays':
      return { frequency: 'WEEKLY', interval: 1, daysOfWeek: [1, 2, 3, 4, 5] }
    default:
      return null
  }
}
