// The "Upcoming Event" heads-up: one notice the day before an event, by
// in-app, push and email only, never text (texts come at the reminder times
// picked on the event: app/api/cron/event-reminders). It used to go out
// as soon as an event was less than 48 hours away ("starts in 2 days"),
// including right after creating an event for later today.
//
// The hourly cron (/api/cron/notifications, minute 0) sends it when a timed
// event starts 22-24 hours from now (one run lands in that window; a second
// is a duplicate and skipped), and for an all-day event 4-6 hours before its
// midnight start, i.e. the evening before rather than the small hours.

export type HeadsUpChannel = "in_app" | "push" | "email" | "sms"

export const HEADS_UP_TIMED_HOURS = { from: 22, to: 24 } as const
export const HEADS_UP_ALL_DAY_HOURS = { from: 4, to: 6 } as const

/** The event's picked channels without text; null/empty = all of in-app, push, email. */
export function headsUpChannels(eventChannels: string[] | null | undefined): HeadsUpChannel[] {
  const all: HeadsUpChannel[] = ["in_app", "push", "email"]
  if (!eventChannels || eventChannels.length === 0) return all
  return all.filter((c) => eventChannels.includes(c))
}

/** "Soccer" is tomorrow at 4:00 PM at the field / "Halloween" is tomorrow (all day). */
export function headsUpBody(opts: {
  title: string
  start: Date
  allDay: boolean
  location?: string | null
  timeZone?: string | null
}): string {
  let when = "tomorrow (all day)"
  if (!opts.allDay) {
    let time: string
    try {
      time = new Intl.DateTimeFormat("en-US", { timeZone: opts.timeZone || "America/New_York", hour: "numeric", minute: "2-digit" }).format(opts.start)
    } catch {
      time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(opts.start)
    }
    when = `tomorrow at ${time}`
  }
  return `"${opts.title}" is ${when}${opts.location ? ` at ${opts.location}` : ""}`
}
