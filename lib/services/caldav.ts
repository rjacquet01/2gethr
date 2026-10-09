/**
 * Minimal CalDAV client for iCloud, built from scratch with raw fetch() +
 * hand-written XML/ICS parsing.
 *
 * Why hand-rolled: there's no public "Apple OAuth" for third-party
 * calendar/reminders access the way Google offers one. Apple's iCloud
 * CalDAV service is the real mechanism, authenticated with Basic Auth using
 * an app-specific password (not the user's regular Apple ID password).
 * No CalDAV npm package (tsdav, dav, etc.) could be installed in the
 * sandbox this was built in, so this talks CalDAV directly: PROPFIND for
 * discovery, REPORT for listing events/todos, PUT for create/update, DELETE
 * for removal, and a small ICS (iCalendar) reader/writer for VEVENT/VTODO.
 *
 * This intentionally implements only what Togethr's sync needs - it is not
 * a general-purpose CalDAV library.
 */

export interface CalDavCredentials {
  username: string // Apple ID email
  password: string // app-specific password
}

export interface CalDavDiscovery {
  server: string // e.g. https://caldav.icloud.com (or the per-user pXX- host Apple redirects to)
  principalUrl: string
  calendarHomeSet: string
  eventsCalendarUrl: string | null
  tasksCalendarUrl: string | null
}

const ICLOUD_WELL_KNOWN = 'https://caldav.icloud.com/.well-known/caldav'

function authHeader(creds: CalDavCredentials): string {
  return 'Basic ' + Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
}

/**
 * fetch() follows redirects automatically by default, but CalDAV discovery
 * specifically needs the Location header from a 301/302 (iCloud redirects
 * .well-known/caldav to a per-account host like p123-caldav.icloud.com), so
 * we do it manually with redirect: 'manual' at the first hop and let fetch
 * auto-follow for everything else.
 */
async function caldavRequest(
  url: string,
  creds: CalDavCredentials,
  method: string,
  body?: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      Authorization: authHeader(creds),
      'Content-Type': 'application/xml; charset=utf-8',
      Depth: extraHeaders?.Depth ?? '0',
      ...extraHeaders,
    },
    body,
  })
}

function extractTag(xml: string, tag: string): string | null {
  // Namespaced XML tags come back as either <d:tag> or <tag> depending on
  // the server's chosen prefix, so match loosely on the local name.
  const re = new RegExp(`<[^:>]*:?${tag}[^>]*>([^<]*)</[^:>]*:?${tag}>`, 'i')
  const match = xml.match(re)
  return match ? match[1].trim() : null
}

/**
 * Return the <href> that sits INSIDE the named property element (e.g. the
 * href within <current-user-principal> or <calendar-home-set>). extractTag()
 * alone returns the FIRST href in the document, which in a PROPFIND
 * multistatus reply is the response's own URL ("/"), not the property's
 * value - that mix-up made discovery PROPFIND the server root instead of the
 * user's calendar home, and iCloud answered "Failed to list calendars (400)".
 */
function extractPropHref(xml: string, prop: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${prop}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${prop}>`, 'i')
  const m = xml.match(re)
  if (!m) return null
  return extractTag(m[1], 'href')
}

function extractAllHrefBlocks(xml: string): string[] {
  // Split a multistatus response into one chunk per <response> element.
  const blocks: string[] = []
  const re = /<[^:>]*:?response[^>]*>([\s\S]*?)<\/[^:>]*:?response>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[1])
  }
  return blocks
}

/**
 * Discover the user's calendar-home-set and pick the two collections we
 * care about: the primary events calendar, and a task list ("Reminders"
 * live in CalDAV as VTODO collections too).
 */
export async function discoverCalDav(creds: CalDavCredentials): Promise<CalDavDiscovery> {
  // Step 1: well-known redirect to the account's actual CalDAV host.
  const wellKnownRes = await fetch(ICLOUD_WELL_KNOWN, {
    method: 'PROPFIND',
    redirect: 'manual',
    headers: { Authorization: authHeader(creds), Depth: '0' },
  })

  let server = 'https://caldav.icloud.com'
  const location = wellKnownRes.headers.get('location')
  if (location) {
    try {
      server = new URL(location).origin
    } catch {
      // fall back to default
    }
  }

  // Step 2: current-user-principal
  const principalBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:current-user-principal/></D:prop>
</D:propfind>`

  const principalRes = await caldavRequest(`${server}/`, creds, 'PROPFIND', principalBody, { Depth: '0' })
  if (!principalRes.ok) {
    throw new Error(`CalDAV authentication failed (${principalRes.status}). Check the Apple ID and app-specific password.`)
  }
  const principalXml = await principalRes.text()
  const principalHref = extractPropHref(principalXml, 'current-user-principal')
  if (!principalHref) {
    throw new Error('Could not discover CalDAV principal URL')
  }
  const principalUrl = new URL(principalHref, server).toString()

  // Step 3: calendar-home-set
  const homeBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`

  const homeRes = await caldavRequest(principalUrl, creds, 'PROPFIND', homeBody, { Depth: '0' })
  if (!homeRes.ok) {
    throw new Error(`Failed to discover calendar home (${homeRes.status})`)
  }
  const homeXml = await homeRes.text()
  const homeHref = extractPropHref(homeXml, 'calendar-home-set')
  if (!homeHref) {
    throw new Error('Could not discover calendar-home-set')
  }
  const calendarHomeSet = new URL(homeHref, server).toString()
  // iCloud hands out an absolute per-account host (pNN-caldav.icloud.com);
  // everything after this must be resolved against THAT host.
  server = new URL(calendarHomeSet).origin

  // Step 4: enumerate collections under the home set, and classify by
  // supported-calendar-component-set (VEVENT vs VTODO).
  const listBody = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`

  const listRes = await caldavRequest(calendarHomeSet, creds, 'PROPFIND', listBody, { Depth: '1' })
  if (!listRes.ok) {
    throw new Error(`Failed to list calendars (${listRes.status})`)
  }
  const listXml = await listRes.text()
  const blocks = extractAllHrefBlocks(listXml)

  let eventsCalendarUrl: string | null = null
  let tasksCalendarUrl: string | null = null
  let tasksFallbackUrl: string | null = null

  for (const block of blocks) {
    const href = extractTag(block, 'href')
    if (!href) continue
    // A real calendar collection has an empty <calendar/> element inside its
    // resourcetype (not just any element whose name contains "calendar",
    // e.g. schedule-inbox / calendarserver extensions).
    const isCollection = /<(?:[\w-]+:)?calendar\s*\/>/i.test(block)
    if (!isCollection) continue

    const hasVEVENT = /comp[^>]*name="VEVENT"/i.test(block)
    const hasVTODO = /comp[^>]*name="VTODO"/i.test(block)
    const fullUrl = new URL(href, server).toString()

    if (hasVTODO && !hasVEVENT) {
      if (!tasksCalendarUrl) tasksCalendarUrl = fullUrl
    } else if (hasVEVENT) {
      if (!eventsCalendarUrl) eventsCalendarUrl = fullUrl
      // Older mixed-use calendars accept both; keep as a fallback task list.
      if (hasVTODO && !tasksFallbackUrl) tasksFallbackUrl = fullUrl
    }
  }
  if (!tasksCalendarUrl && tasksFallbackUrl && tasksFallbackUrl !== eventsCalendarUrl) {
    tasksCalendarUrl = tasksFallbackUrl
  }

  return { server, principalUrl, calendarHomeSet, eventsCalendarUrl, tasksCalendarUrl }
}

export interface CalDavItem {
  href: string
  etag: string | null
  uid: string
  raw: string // full VEVENT/VTODO iCal block
}

/**
 * REPORT calendar-query for all VEVENT or VTODO items in a collection.
 * Apple limits time-range-free VTODO queries, so this asks for everything
 * currently in the collection rather than filtering server-side.
 */
export async function listCalDavItems(
  collectionUrl: string,
  creds: CalDavCredentials,
  component: 'VEVENT' | 'VTODO'
): Promise<CalDavItem[]> {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="${component}"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`

  const res = await caldavRequest(collectionUrl, creds, 'REPORT', body, { Depth: '1' })
  if (!res.ok) {
    throw new Error(`CalDAV REPORT failed (${res.status})`)
  }
  const xml = await res.text()
  const blocks = extractAllHrefBlocks(xml)

  const items: CalDavItem[] = []
  for (const block of blocks) {
    const href = extractTag(block, 'href')
    const etag = extractTag(block, 'getetag')
    const calDataMatch = block.match(/<[^:>]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:>]*:?calendar-data>/i)
    if (!href || !calDataMatch) continue
    const raw = decodeXmlEntities(calDataMatch[1])
    const uid = parseIcsField(raw, 'UID') || href
    items.push({ href: new URL(href, collectionUrl).toString(), etag, uid, raw })
  }
  return items
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** Pull a single unfolded field value (e.g. SUMMARY, DTSTART, STATUS) out of a raw ICS block. */
export function parseIcsField(ics: string, field: string): string | null {
  // ICS "folds" long lines with CRLF + leading space; unfold first.
  const unfolded = ics.replace(/\r?\n[ \t]/g, '')
  const re = new RegExp(`^${field}(?:;[^:\\n]*)?:(.*)$`, 'im')
  const match = unfolded.match(re)
  return match ? match[1].trim() : null
}

/**
 * Split a whole .ics file's text into one raw string per VEVENT or VTODO
 * block (each re-wrapped in its own BEGIN:VCALENDAR/END:VCALENDAR so
 * parseIcsField's per-block field lookups keep working the same way they
 * do on a single CalDAV REPORT item). Used by the generic file/URL import
 * path, where there's no CalDAV server to ask for items individually - the
 * whole exported calendar (Outlook, Android, iOS, Google Takeout, etc.)
 * arrives as one multi-component .ics document.
 */
export function splitIcsComponents(icsText: string, component: 'VEVENT' | 'VTODO'): string[] {
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '')
  const re = new RegExp(`BEGIN:${component}[\\s\\S]*?END:${component}`, 'gi')
  const matches = unfolded.match(re) || []
  return matches.map((block) => `BEGIN:VCALENDAR\r\n${block}\r\nEND:VCALENDAR`)
}

/** Parse an ICS DATE (YYYYMMDD) or DATE-TIME (YYYYMMDDTHHMMSSZ, or floating/local without Z) value into an ISO string. */
export function parseIcsDateValue(value: string): string {
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/)
  if (!m) return new Date().toISOString()
  const [, y, mo, d, h, mi, s] = m
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`
}

function icsEscape(text: string): string {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function toIcsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

export function buildVEvent(opts: {
  uid: string
  title: string
  description?: string | null
  location?: string | null
  start: Date
  end: Date
  allDay?: boolean
}): string {
  const now = toIcsDateTime(new Date())
  const dtStart = opts.allDay
    ? `DTSTART;VALUE=DATE:${opts.start.toISOString().split('T')[0].replace(/-/g, '')}`
    : `DTSTART:${toIcsDateTime(opts.start)}`
  const dtEnd = opts.allDay
    ? `DTEND;VALUE=DATE:${opts.end.toISOString().split('T')[0].replace(/-/g, '')}`
    : `DTEND:${toIcsDateTime(opts.end)}`

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Togethr//Calendar Sync//EN',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${now}`,
    dtStart,
    dtEnd,
    `SUMMARY:${icsEscape(opts.title)}`,
    opts.description ? `DESCRIPTION:${icsEscape(opts.description)}` : '',
    opts.location ? `LOCATION:${icsEscape(opts.location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

export function buildVTodo(opts: {
  uid: string
  title: string
  description?: string | null
  due?: Date | null
  completed?: boolean
  /** Fire a device alert this many minutes before DUE (0 = at due time). Omit for no alarm. */
  alarmMinutesBefore?: number | null
}): string {
  const now = toIcsDateTime(new Date())
  const alarm =
    opts.due && opts.alarmMinutesBefore != null && !opts.completed
      ? [
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `DESCRIPTION:${icsEscape(opts.title)}`,
          `TRIGGER:${opts.alarmMinutesBefore <= 0 ? 'PT0S' : `-PT${Math.round(opts.alarmMinutesBefore)}M`}`,
          'END:VALARM',
        ]
      : []
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Togethr//Task Sync//EN',
    'BEGIN:VTODO',
    `UID:${opts.uid}`,
    `DTSTAMP:${now}`,
    opts.due ? `DUE:${toIcsDateTime(opts.due)}` : '',
    `SUMMARY:${icsEscape(opts.title)}`,
    opts.description ? `DESCRIPTION:${icsEscape(opts.description)}` : '',
    `STATUS:${opts.completed ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    opts.completed ? `COMPLETED:${now}` : '',
    ...alarm,
    'END:VTODO',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

function icsUnescape(text: string): string {
  return text.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

export interface ParsedVTodo {
  uid: string
  title: string
  description: string | null
  due: string | null // ISO
  completed: boolean
  lastModified: string | null // ISO
  /** Created by Togethr itself (so a pull must not re-import it as a "new" item). */
  fromTogethr: boolean
}

function tzOffsetMs(timeZone: string, atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(atUtcMs))
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10)
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - atUtcMs
}

/**
 * DUE/LAST-MODIFIED in a VTODO is often "DUE;TZID=America/New_York:20261010T150000"
 * (a wall-clock time in a named zone) or a floating time. Read it as that
 * wall-clock time in the stated zone (falling back to UTC) instead of
 * mislabelling it as UTC.
 */
function parseIcsDateField(ics: string, field: string): string | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '')
  const m = unfolded.match(new RegExp(`^${field}((?:;[^:\\n]*)?):(.*)$`, 'im'))
  if (!m) return null
  const value = m[2].trim()
  const tzid = m[1].match(/TZID=([^;:]+)/i)?.[1]
  const mm = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/)
  if (tzid && mm) {
    const [, y, mo, d, h, mi, sec] = mm
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)
    try {
      let guess = wall - tzOffsetMs(tzid.replace(/^"|"$/g, ''), wall)
      guess = wall - tzOffsetMs(tzid.replace(/^"|"$/g, ''), guess)
      return new Date(guess).toISOString().replace(/\.\d{3}Z$/, 'Z')
    } catch {
      // unknown zone name - fall through to the UTC reading
    }
  }
  return parseIcsDateValue(value)
}

/** Read the fields Togethr cares about out of one raw VTODO block. */
export function parseVTodo(rawWithAlarms: string): ParsedVTodo | null {
  // VALARM sub-components carry their own DESCRIPTION/TRIGGER lines that must
  // not be mistaken for the task's.
  const raw = rawWithAlarms.replace(/BEGIN:VALARM[\s\S]*?END:VALARM/gi, '')
  const uid = parseIcsField(raw, 'UID')
  const summary = parseIcsField(raw, 'SUMMARY')
  if (!uid || !summary) return null
  const due = parseIcsDateField(raw, 'DUE')
  const status = (parseIcsField(raw, 'STATUS') || '').toUpperCase()
  const completedField = parseIcsField(raw, 'COMPLETED')
  const lm = parseIcsDateField(raw, 'LAST-MODIFIED')
  const desc = parseIcsField(raw, 'DESCRIPTION')
  return {
    uid,
    title: icsUnescape(summary),
    description: desc ? icsUnescape(desc) : null,
    due,
    completed: status === 'COMPLETED' || !!completedField,
    lastModified: lm,
    fromTogethr: /@togethr\.app$|@togethrapp\.com$/i.test(uid),
  }
}

/** PUT (create or update) a single VEVENT/VTODO. `itemUrl` must end in `<uid>.ics`. */
export async function putCalDavItem(itemUrl: string, creds: CalDavCredentials, icsBody: string, etag?: string | null): Promise<boolean> {
  const res = await caldavRequest(itemUrl, creds, 'PUT', icsBody, {
    'Content-Type': 'text/calendar; charset=utf-8',
    ...(etag ? { 'If-Match': etag } : {}),
  })
  return res.ok
}

export async function deleteCalDavItem(itemUrl: string, creds: CalDavCredentials): Promise<boolean> {
  const res = await caldavRequest(itemUrl, creds, 'DELETE')
  return res.ok || res.status === 404
}

/** Quick credential check used at connect-time: discovery succeeding means auth worked. */
export async function verifyCalDavCredentials(creds: CalDavCredentials): Promise<CalDavDiscovery> {
  return discoverCalDav(creds)
}
