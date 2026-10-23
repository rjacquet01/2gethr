import { addDays, addMinutes, set, startOfWeek } from 'date-fns'

// Dates and times in Quick Add text, typed or spoken ("5:30 p.m.", "tonight
// at 9", "every Monday", "October 30th", "in half an hour"). Used by the
// Tasks and Reminders quick add; the phrase it finds is cut from the text.

export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface When {
  /** The text with the date/time words removed (not yet tidied). */
  rest: string
  at: Date | null
  /** A clock time or part of day was given (otherwise `at` is just the day, at 9 AM). */
  hasTime: boolean
  recurrence: Recurrence
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// Whole weekday names and their usual abbreviations only, so "friend",
// "monthly" or "sunscreen" are never read as days.
const WEEKDAY = 'sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?'
const WEEKDAYS = 'sundays|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays'
const MONTH =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const ORD = '(\\d{1,2})(?:st|nd|rd|th)?'

type Part = 'morning' | 'afternoon' | 'evening' | 'night'
const PART_HOUR: Record<Part, number> = { morning: 9, afternoon: 14, evening: 18, night: 20 }

const dayIndex = (w: string) => DAY_NAMES.findIndex((x) => x.startsWith(w.slice(0, 3).toLowerCase()))
/** The next such weekday; today counts only when `orToday`. */
function nextWeekday(w: string, now: Date, orToday = false): Date | null {
  const idx = dayIndex(w)
  if (idx < 0) return null
  const diff = (idx - now.getDay() + 7) % 7
  return addDays(now, diff === 0 && !orToday ? 7 : diff)
}
/** That month/day this year, or next year if it has passed. */
function nextDate(month: number, day: number, now: Date, year?: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null
  let d = new Date(year ?? now.getFullYear(), month, day, now.getHours(), now.getMinutes())
  if (d.getMonth() !== month) return null
  if (!year && d < set(now, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 })) d = new Date(d.getFullYear() + 1, month, day)
  return d
}

export function parseWhen(raw: string, now: Date = new Date()): When {
  // Voice input writes "5:30 p.m." and "6 o'clock".
  let text = (' ' + raw.trim() + ' ')
    .replace(/(\d\s*)([ap])\.\s?m\.?(?=\s)/gi, '$1$2m')
    .replace(/(\d)\s*o['’]?\s?clock\b/gi, '$1')
  let recurrence = 'NONE' as Recurrence
  // Held in an object so TypeScript doesn't narrow these to their initial
  // values (they're assigned inside the replace callbacks below).
  const st = {
    rel: null as Date | null,
    day: null as Date | null,
    part: null as Part | null,
    h: null as number | null,
    m: 0,
    ampm: null as 'am' | 'pm' | null,
    viaAt: false,
  }
  const cut = (re: RegExp, fn: (...g: string[]) => boolean | void) => {
    text = text.replace(re, (...a) => (fn(...(a.slice(0, -2) as string[])) === false ? a[0] : ' '))
  }

  // Repeats: "every Monday", "on Mondays", "every day", "weekly"
  cut(new RegExp(`\\s(?:every|each)\\s+(${WEEKDAY})\\b`, 'i'), (_m, d) => {
    recurrence = 'WEEKLY'
    st.day = nextWeekday(d, now, true)
  })
  cut(new RegExp(`\\son\\s+(${WEEKDAYS})\\b`, 'i'), (_m, d) => {
    recurrence = 'WEEKLY'
    st.day = nextWeekday(d, now, true)
  })
  const repeatOf = (w: string): Recurrence =>
    w.startsWith('day') || w === 'daily' ? 'DAILY' : w.startsWith('week') ? 'WEEKLY' : w.startsWith('month') ? 'MONTHLY' : 'YEARLY'
  cut(/\s(?:every|each)\s+(day|week|month|year)\b/i, (_m, w) => {
    recurrence = repeatOf(w.toLowerCase())
  })

  // From now: "in 2 hours", "in an hour and a half", "in half an hour"
  cut(/\sin\s+half\s+an?\s+hour\b/i, () => {
    st.rel = addMinutes(now, 30)
  })
  cut(/\sin\s+(an?|one|\d+)\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|[mhd])(\s+and\s+a\s+half)?\b/i, (_m, n, u, half) => {
    const k = /^\d/.test(n) ? parseInt(n, 10) : 1
    const unit = u.toLowerCase()
    const mins = unit.startsWith('m') ? k : unit.startsWith('h') ? k * 60 : unit.startsWith('w') ? k * 7 * 1440 : k * 1440
    st.rel = addMinutes(now, half ? mins * 1.5 : mins)
  })

  // Calendar dates: "October 30th", "Oct 30, 2027", "the 30th of October", "10/30", "on the 1st"
  cut(new RegExp(`\\s(?:on\\s+|by\\s+)?(?:the\\s+)?(${MONTH})\\.?\\s+${ORD}\\b(?:,?\\s+(\\d{4}))?`, 'i'), (_m, mo, d, y) => {
    const date = nextDate(MONTHS.indexOf(mo.slice(0, 3).toLowerCase()), parseInt(d, 10), now, y ? parseInt(y, 10) : undefined)
    if (!date) return false
    st.day = date
  })
  cut(new RegExp(`\\s(?:on\\s+|by\\s+)?(?:the\\s+)?${ORD}\\s+of\\s+(${MONTH})\\b`, 'i'), (_m, d, mo) => {
    const date = nextDate(MONTHS.indexOf(mo.slice(0, 3).toLowerCase()), parseInt(d, 10), now)
    if (!date) return false
    st.day = date
  })
  cut(/\s(?:on\s+|by\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s)/, (_m, mo, d, y) => {
    const year = y ? (y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)) : undefined
    const date = nextDate(parseInt(mo, 10) - 1, parseInt(d, 10), now, year)
    if (!date) return false
    st.day = date
  })
  cut(/\s(?:on\s+|by\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (_m, d) => {
    const day = parseInt(d, 10)
    let date = nextDate(now.getMonth(), day, now)
    if (date && date.getFullYear() > now.getFullYear()) date = null
    if (!date) date = nextDate((now.getMonth() + 1) % 12, day, now)
    if (!date) return false
    st.day = date
  })

  // Days: "today", "tonight", "tomorrow morning", "next week", "(on/by) Friday"
  cut(/\s(today|tonight|tomorrow|tmrw)\b/i, (_m, d) => {
    const w = d.toLowerCase()
    st.day = w === 'today' || w === 'tonight' ? new Date(now) : addDays(now, 1)
    if (w === 'tonight') st.part = 'night'
  })
  cut(/\snext\s+week\b/i, () => {
    st.day = addDays(startOfWeek(now, { weekStartsOn: 1 }), 7)
  })
  cut(new RegExp(`\\s(?:on\\s+|by\\s+)?(?:(?:next|this)\\s+)?(${WEEKDAY})\\b`, 'i'), (_m, d) => {
    const date = nextWeekday(d, now)
    if (!date) return false
    st.day = st.day ?? date
  })
  cut(/\s(?:(this|in\s+the)\s+)?(morning|afternoon|evening)\b|\s(?:at|during\s+the)\s+(night)\b/i, (_m, pre, p, n) => {
    st.part = ((p || n) as string).toLowerCase() as Part
    if (pre?.toLowerCase() === 'this' && !st.day) st.day = new Date(now)
  })

  // Clock times: "5:30pm", "8 am", "17:45", "at 5:30", "at 9", "noon"
  const time12 = /\s(at\s+|by\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  const time24 = /\s(at\s+|by\s+)?(\d{1,2}):(\d{2})\b/i
  const timeWord = /\s(?:at\s+|by\s+)?(noon|midnight)\b/i
  const timeAt = /\s(at|by)\s+(\d{1,2})\b(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|%|\/))/i
  if (time12.test(text)) {
    cut(time12, (_m, at, h, m, ap) => {
      st.h = parseInt(h, 10) % 12
      st.m = m ? parseInt(m, 10) : 0
      st.ampm = ap.toLowerCase() as 'am' | 'pm'
      st.viaAt = !!at
    })
  } else if (time24.test(text)) {
    cut(time24, (_m, at, h, m) => {
      st.h = Math.min(23, parseInt(h, 10))
      st.m = Math.min(59, parseInt(m, 10))
      st.viaAt = !!at
    })
  } else if (timeWord.test(text)) {
    cut(timeWord, (_m, w) => {
      st.h = 0
      st.ampm = w.toLowerCase() === 'noon' ? 'pm' : 'am'
    })
  } else if (timeAt.test(text)) {
    cut(timeAt, (_m, _at, h) => {
      st.h = Math.min(23, parseInt(h, 10))
      st.viaAt = true
    })
  }

  // "daily" etc. only as the last word ("take meds at 8am daily"), so a
  // "monthly bill" or "daily standup" keeps its words.
  if (recurrence === 'NONE') {
    cut(/\s(daily|weekly|monthly|yearly)[\s.,!]*$/i, (_m, w) => {
      recurrence = repeatOf(w.toLowerCase())
    })
  }

  let hour: number | null = null
  if (st.h !== null) {
    if (st.ampm === 'pm') hour = st.h + 12
    else if (st.ampm === 'am') hour = st.h
    else if (st.h > 12) hour = st.h
    else if (st.part === 'morning') hour = st.h % 12
    else if (st.part) hour = st.h < 12 ? st.h + 12 : st.h
    // "at 5" or "at 5:30" is nearly always the evening unless it's 8-11
    else if (st.viaAt && st.h >= 1 && st.h <= 7) hour = st.h + 12
    else hour = st.h
  }

  let at: Date | null = null
  if (st.rel) {
    at = st.rel
  } else if (st.day || hour !== null || st.part) {
    at = set(st.day || now, {
      hours: hour ?? (st.part ? PART_HOUR[st.part] : 9),
      minutes: hour !== null ? st.m : 0,
      seconds: 0,
      milliseconds: 0,
    })
    if (at.getTime() <= now.getTime()) {
      // A time with no day ("8am") that already passed means tomorrow;
      // a repeat that already passed today starts next time.
      if (!st.day && hour !== null) at = addDays(at, 1)
      else if (recurrence === 'WEEKLY') at = addDays(at, 7)
      else if (recurrence === 'DAILY') at = addDays(at, 1)
    }
  }
  return { rest: text, at, hasTime: !!st.rel || hour !== null || !!st.part, recurrence }
}

/** Tidies what is left of the text into a title. */
export function tidyTitle(rest: string): string {
  let t = rest
    // Punctuation left behind by removed words, or a spoken full stop
    .replace(/\s[.,!?]+(?=\s)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (let i = 0; i < 3; i++) t = t.replace(/[.,!]+$/, '').replace(/\s+(at|on|by|for|in|the|every|this|of|and)$/i, '').trim()
  return t
}
