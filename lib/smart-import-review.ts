import { localDateTimeToISO, localEndOfDayToISO, localStartOfDayToISO } from "./datetime"

// Review-screen helpers for Smart Import (browser-safe, no zod): the times an
// approved suggestion is saved with, and the "already on the calendar" check.

export interface ReviewEvent {
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  allDay: boolean
}

/** UTC start/end for POST /api/events, in this device's time zone. No end time: one hour. */
export function reviewEventTimes(e: ReviewEvent): { startTime: string; endTime: string } {
  if (e.allDay || !e.startTime) return { startTime: localStartOfDayToISO(e.date), endTime: localEndOfDayToISO(e.date) }
  const startTime = localDateTimeToISO(e.date, e.startTime)
  const endTime = e.endTime && e.endTime > e.startTime
    ? localDateTimeToISO(e.date, e.endTime)
    : new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString()
  return { startTime, endTime }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/** Same title and same start as an event already in the family's calendar. */
export function findDuplicate<T extends { title: string; startTime: string; isAllDay?: boolean }>(e: ReviewEvent, existing: T[]): T | null {
  const { startTime } = reviewEventTimes(e)
  const start = new Date(startTime).getTime()
  return existing.find((x) => norm(x.title) === norm(e.title) && new Date(x.startTime).getTime() === start) ?? null
}
