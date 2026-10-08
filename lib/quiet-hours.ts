// Is "now" inside a user's quiet hours? Hours are wall-clock times in the
// user's own timezone ("22:00" - "07:00"), and a window may wrap past midnight.
// Previously the crons compared against the server's clock (UTC on Vercel) and
// ignored wrap-around, so quiet hours fired at the wrong time or never.
export function isQuietNow(
  start: string | null | undefined,
  end: string | null | undefined,
  timeZone: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!start || !end) return false
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':')
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0)
  }
  const startMin = toMinutes(start)
  const endMin = toMinutes(end)
  if (startMin === endMin) return false

  let current: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now)
    const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10)
    const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10)
    current = h * 60 + m
  } catch {
    current = now.getUTCHours() * 60 + now.getUTCMinutes()
  }

  return startMin < endMin
    ? current >= startMin && current < endMin
    : current >= startMin || current < endMin
}
