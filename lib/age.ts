// Birthdate helpers. A date of birth is a plain calendar date "YYYY-MM-DD"
// (no time zone). Ages are calendar-correct: you are N on your Nth birthday,
// and someone born on 29 February has their birthday on 1 March in years
// that are not leap years.

export const ADULT_AGE = 18
export const MAX_CHILD_AGE = 25

const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/

type Ymd = { y: number; m: number; d: number }

function parseDob(dob: string): Ymd | null {
  const match = DOB_RE.exec(dob)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return { y, m, d }
}

function todayYmd(now: Date): Ymd {
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() }
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** The date someone born on `dob` turns `years` (29 Feb -> 1 Mar in non-leap years). */
function birthdayIn(dob: Ymd, years: number): Ymd {
  const y = dob.y + years
  if (dob.m === 2 && dob.d === 29 && !isLeap(y)) return { y, m: 3, d: 1 }
  return { y, m: dob.m, d: dob.d }
}

const toUtc = (v: Ymd) => Date.UTC(v.y, v.m - 1, v.d)
const fmt = (v: Ymd) => `${v.y}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`

/** Whole years old on `now` (default today), or null for an invalid date. */
export function ageFromDob(dob: string, now: Date = new Date()): number | null {
  const b = parseDob(dob)
  if (!b) return null
  const t = todayYmd(now)
  let age = t.y - b.y
  const thisYear = birthdayIn(b, age)
  if (toUtc(t) < toUtc(thisYear)) age -= 1
  return age
}

/** The calendar date (YYYY-MM-DD) of the birthday on which they turn `turning`. */
export function birthdayDate(dob: string, turning: number): string | null {
  const b = parseDob(dob)
  return b ? fmt(birthdayIn(b, turning)) : null
}

/** Days from today until they turn `turning` (0 = today, negative = already passed). */
export function daysUntilBirthday(dob: string, turning: number, now: Date = new Date()): number | null {
  const b = parseDob(dob)
  if (!b) return null
  return Math.round((toUtc(birthdayIn(b, turning)) - toUtc(todayYmd(now))) / 86400000)
}

/** At least `n` years old, from a date of birth (preferred) or a plain age. */
export function isAtLeast(dobOrAge: string | number | null | undefined, n: number, now: Date = new Date()): boolean {
  if (dobOrAge === null || dobOrAge === undefined || dobOrAge === "") return false
  if (typeof dobOrAge === "number") return dobOrAge >= n
  const age = ageFromDob(dobOrAge, now)
  return age !== null && age >= n
}

/**
 * Validate a date of birth sent by a client. Returns an error message, or
 * null when it is a real, non-future date for someone aged 0-25.
 */
export function dobError(dob: string, now: Date = new Date()): string | null {
  const b = parseDob(dob)
  if (!b) return "Birthdate must be a real date in YYYY-MM-DD format"
  if (toUtc(b) > toUtc(todayYmd(now))) return "Birthdate can't be in the future"
  const age = ageFromDob(dob, now)
  if (age === null || age > MAX_CHILD_AGE) return `Birthdate gives an age over ${MAX_CHILD_AGE}`
  return null
}

/** The best known age: from the birthdate when there is one, else the stored integer. */
export function effectiveAge(dob: string | null | undefined, storedAge: number | null | undefined, now: Date = new Date()): number | null {
  if (dob) {
    const a = ageFromDob(dob, now)
    if (a !== null) return a
  }
  return storedAge ?? null
}

export interface ChildAgeInfo {
  dateOfBirth: string | null
  age: number | null
  /** Doesn't have their own login yet, so a parent can invite them to one (any age). */
  canHaveAccount: boolean
  turns18On: string | null
  daysUntil18: number | null
  /** 18+, still a CHILD member, and the prompt isn't snoozed. */
  needsRoleChoice: boolean
}

/** What a GUEST viewer gets instead: no birthdate or age-derived data. */
export const GUEST_AGE_INFO: ChildAgeInfo = {
  dateOfBirth: null,
  age: null,
  canHaveAccount: false,
  turns18On: null,
  daysUntil18: null,
  needsRoleChoice: false,
}

/** Age-derived fields the children APIs return for one child. */
export function childAgeInfo(row: {
  dob: string | null
  age: number | null
  role: string | null
  userId: string | null
  snoozedUntil: string | Date | null
}, now: Date = new Date()): ChildAgeInfo {
  const dob = row.dob || null
  const age = effectiveAge(dob, row.age, now)
  const snoozed = row.snoozedUntil ? new Date(row.snoozedUntil).getTime() > now.getTime() : false
  return {
    dateOfBirth: dob,
    age,
    canHaveAccount: !row.userId,
    turns18On: dob ? birthdayDate(dob, ADULT_AGE) : null,
    daysUntil18: dob ? daysUntilBirthday(dob, ADULT_AGE, now) : null,
    needsRoleChoice: age !== null && age >= ADULT_AGE && row.role === "CHILD" && !snoozed,
  }
}
