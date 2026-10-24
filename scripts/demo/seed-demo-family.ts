// Usage: npm run demo:seed   (rebuilds the demo family; safe to run again)
//        npm run demo:reset  (removes it)
//
// A fictional family for Play Store screenshots: "The Rivera Family". Dev
// branch only (scripts/demo/guard.ts refuses production). Every date is
// relative to today so the screens always look fresh. The owner's sign-in
// goes only into .env.demo.local (gitignored); nothing secret is printed.
// Places sit at public spots in Newton and downtown Boston: no real home and
// no street addresses.
import { pointAtDevDatabaseOrExit } from "./guard"
pointAtDevDatabaseOrExit()

import fs from "fs"
import path from "path"
import crypto from "crypto"
import bcrypt from "bcryptjs"
import { neon } from "@neondatabase/serverless"
import { CHILD_CONSENT_TEXT, CHILD_CONSENT_VERSION } from "@/lib/consent-text"

const sql = neon(process.env.DATABASE_URL!)
const TZ = "America/New_York"
const DOMAIN = "togethr.test"
const OWNER_EMAIL = `demo@${DOMAIN}`
const ENV_FILE = path.join(process.cwd(), ".env.demo.local")

const id = () => crypto.randomUUID()

// ---- time, in the family's time zone -------------------------------------

function nyOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" })
    .formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT"
  const m = /GMT([+-]\d+)(?::(\d+))?/.exec(name)
  return m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0
}

/** Today (+dayOffset) at h:m in New York. */
function at(dayOffset: number, h: number, m = 0): Date {
  const [y, mo, d] = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()).split("-").map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d + dayOffset, h, m))
  return new Date(guess.getTime() - nyOffsetMinutes(guess) * 60_000)
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const todayDow = DAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(new Date()))
/** Days from today to weekday `dow` this week (0 = Sunday), negative if already past. */
const thisWeek = (dow: number) => dow - todayDow
/** Days to the next `dow`, today excluded. */
const nextDow = (dow: number) => ((dow - todayDow + 7) % 7) || 7
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000)
/** A morning time today if it has passed, else the same time yesterday. */
const earlier = (h: number, m: number) => (at(0, h, m).getTime() < Date.now() ? at(0, h, m) : at(-1, h, m))

// ---- the family ----------------------------------------------------------

type Person = {
  key: string; first: string; email?: string; role: "PARENT" | "CHILD" | "GUEST"
  color: string; emoji: string; age?: number; grade?: string
}
const PEOPLE: Person[] = [
  { key: "maria", first: "Maria", email: OWNER_EMAIL, role: "PARENT", color: "#3B82F6", emoji: "🌻" },
  { key: "carlos", first: "Carlos", email: `carlos@${DOMAIN}`, role: "PARENT", color: "#10B981", emoji: "🚲" },
  { key: "sofia", first: "Sofia", email: `sofia@${DOMAIN}`, role: "CHILD", color: "#8B5CF6", emoji: "⚽", age: 14, grade: "9th" },
  { key: "mateo", first: "Mateo", role: "CHILD", color: "#F97316", emoji: "🦖", age: 9, grade: "4th" },
  { key: "rosa", first: "Rosa", email: `rosa@${DOMAIN}`, role: "GUEST", color: "#EC4899", emoji: "🌺" },
]
const DEMO_EMAILS = PEOPLE.filter((p) => p.email).map((p) => p.email!)

// Public spots, rounded. Each gets a town-level address: with none saved, the
// Places page looks one up and would show a real street address.
const PLACES = {
  home: { name: "Home", area: "Newton, MA", lat: 42.337, lng: -71.2092, icon: "home", color: "#3B82F6", alerts: true },
  school: { name: "School", area: "Newton, MA", lat: 42.3524, lng: -71.205, icon: "school", color: "#8B5CF6", alerts: true },
  work: { name: "Work", area: "Downtown Boston, MA", lat: 42.3555, lng: -71.0605, icon: "briefcase", color: "#10B981", alerts: true },
  // Plus allows alerts at 3 places (lib/subscription-tiers.ts), so the field is saved without them.
  field: { name: "Soccer Field", area: "Newton, MA", lat: 42.3277, lng: -71.216, icon: "trophy", color: "#F97316", alerts: false },
} as const

// ---- reset ---------------------------------------------------------------

async function reset(): Promise<number> {
  const users = await sql`SELECT id FROM users WHERE email = ANY(${DEMO_EMAILS})`
  const userIds = users.map((u) => u.id as string)
  const fams = await sql`SELECT id FROM families WHERE owner_id = ANY(${userIds})`
  const familyIds = fams.map((f) => f.id as string)
  if (familyIds.length) {
    // Rows with no cascading key back to the family or its users go first.
    await sql`DELETE FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE family_id = ANY(${familyIds}))`
    await sql`DELETE FROM family_post_comments WHERE family_id = ANY(${familyIds})`
    await sql`DELETE FROM family_posts WHERE family_id = ANY(${familyIds})`
    await sql`DELETE FROM reminders WHERE family_id = ANY(${familyIds})`
    await sql`DELETE FROM parental_consents WHERE family_id = ANY(${familyIds})`
    await sql`DELETE FROM families WHERE id = ANY(${familyIds})`
  }
  if (userIds.length) {
    await sql`DELETE FROM events WHERE created_by_id = ANY(${userIds})`
    await sql`DELETE FROM reminders WHERE created_by_id = ANY(${userIds})`
    await sql`DELETE FROM users WHERE id = ANY(${userIds})`
  }
  return familyIds.length
}

// ---- seed ----------------------------------------------------------------

function ownerPassword(): string {
  try {
    const m = fs.readFileSync(ENV_FILE, "utf8").match(/^DEMO_PASSWORD=(.+)$/m)
    if (m) return m[1].trim()
  } catch {}
  return "Demo-" + crypto.randomBytes(12).toString("base64url") + "9!"
}

async function seed() {
  await reset()
  const password = ownerPassword()
  const ownerHash = await bcrypt.hash(password, 12)
  const now = new Date().toISOString()

  // Users (Mateo has no phone or login: the parents track him).
  const user: Record<string, string> = {}
  for (const p of PEOPLE) {
    if (!p.email) continue
    user[p.key] = id()
    const hash = p.key === "maria" ? ownerHash : await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 12)
    const adult = p.role !== "CHILD"
    await sql`
      INSERT INTO users (id, email, password_hash, first_name, last_name, timezone, is_active, email_verified,
        age_confirmed_at, terms_accepted_at, terms_version, last_login_at, last_active_at, created_at, updated_at)
      VALUES (${user[p.key]}, ${p.email}, ${hash}, ${p.first}, 'Rivera', ${TZ}, true, ${now},
        ${adult ? now : null}, ${adult ? now : null}, ${adult ? "2026-01" : null}, ${now}, ${now},
        ${at(-60, 9).toISOString()}, ${now})
    `
    await sql`
      INSERT INTO reminder_settings (id, user_id, push_enabled, email_enabled, sms_enabled, default_reminder_minutes, created_at, updated_at)
      VALUES (${id()}, ${user[p.key]}, true, false, false, ${[15, 60]}, NOW(), NOW())
    `
  }

  const familyId = id()
  await sql`
    INSERT INTO families (id, name, owner_id, invite_code, invite_expires_at, created_at, updated_at)
    VALUES (${familyId}, 'The Rivera Family', ${user.maria}, ${crypto.randomBytes(4).toString("hex").toUpperCase()},
      ${at(7, 0).toISOString()}, ${at(-60, 9).toISOString()}, NOW())
  `

  const member: Record<string, string> = {}
  for (const p of PEOPLE) {
    member[p.key] = id()
    const parent = p.role === "PARENT"
    await sql`
      INSERT INTO family_members (id, family_id, user_id, role, nickname, is_active, joined_at, can_create_events,
        requires_event_approval, can_override_conflicts, can_view_family_calendar, can_invite_members, color, emoji,
        created_at, updated_at)
      VALUES (${member[p.key]}, ${familyId}, ${user[p.key] ?? null}, ${p.role}, ${p.first}, true, ${at(-60, 9).toISOString()},
        true, false, ${parent}, true, ${parent}, ${p.color}, ${p.emoji}, NOW(), NOW())
    `
  }
  const child: Record<string, string> = {}
  for (const p of PEOPLE.filter((x) => x.role === "CHILD")) {
    child[p.key] = id()
    await sql`
      INSERT INTO child_profiles (id, family_member_id, display_name, age, grade, created_at, updated_at)
      VALUES (${child[p.key]}, ${member[p.key]}, ${p.first}, ${p.age ?? null}, ${p.grade ?? null}, NOW(), NOW())
    `
  }

  // Maria agreed to the children's data notice when she added them (lib/parental-consent.ts).
  for (const k of Object.keys(child)) {
    await sql`
      INSERT INTO parental_consents (id, family_id, parent_user_id, child_member_id, child_user_id, scope,
        consent_text_version, consent_text, granted_at)
      VALUES (${id()}, ${familyId}, ${user.maria}, ${member[k]}, ${user[k] ?? null}, ${user[k] ? "CHILD_ACCOUNT" : "CHILD_PROFILE"},
        ${CHILD_CONSENT_VERSION}, ${CHILD_CONSENT_TEXT}, ${at(-60, 9).toISOString()})
    `
  }

  // Plus, paid and current: no trial or past-due banners.
  await sql`
    INSERT INTO subscriptions (id, family_id, tier, status, current_period_start, current_period_end, created_at, updated_at)
    VALUES (${id()}, ${familyId}, 'PREMIUM', 'ACTIVE', ${at(-10, 0).toISOString()}, ${at(20, 0).toISOString()}, NOW(), NOW())
  `

  // ---- places, live location, arrivals ----
  const place: Record<string, string> = {}
  for (const [k, p] of Object.entries(PLACES)) {
    place[k] = id()
    await sql`
      INSERT INTO saved_places (id, family_id, name, address, latitude, longitude, radius, geofence_enabled,
        alert_on_arrival, alert_on_departure, icon, color, created_by_id, created_at, updated_at)
      VALUES (${place[k]}, ${familyId}, ${p.name}, ${p.area}, ${p.lat}, ${p.lng}, 150, ${p.alerts}, true, true,
        ${p.icon}, ${p.color}, ${user.maria}, ${at(-50, 10).toISOString()}, NOW())
    `
  }

  const sharers = { maria: PLACES.work, sofia: PLACES.school, carlos: { lat: 42.3489, lng: -71.1612 } }
  const battery: Record<string, number> = { maria: 72, sofia: 54, carlos: 88 }
  for (const [k, p] of Object.entries(sharers)) {
    await sql`
      INSERT INTO location_settings (id, family_member_id, mode, share_with_family, update_interval_sec, created_at, updated_at)
      VALUES (${id()}, ${member[k]}, 'ACTIVE', true, 300, NOW(), NOW())
    `
    // A little jitter so pins don't sit exactly on the place marker.
    await sql`
      INSERT INTO location_pings (id, user_id, latitude, longitude, accuracy, battery_level, speed, timestamp)
      VALUES (${id()}, ${user[k]}, ${p.lat + 0.0004}, ${p.lng - 0.0003}, 12, ${battery[k]},
        ${k === "carlos" ? 13 : 0}, ${minutesAgo(k === "carlos" ? 1 : 3).toISOString()})
    `
  }
  // The two parents can see each other (lib/location-access.ts).
  for (const [owner, viewer] of [["maria", "carlos"], ["carlos", "maria"]]) {
    await sql`
      INSERT INTO location_access_grants (id, family_id, owner_member_id, viewer_member_id, status, created_at, decided_at)
      VALUES (${id()}, ${familyId}, ${member[owner]}, ${member[viewer]}, 'APPROVED', NOW(), NOW())
    `
  }

  const arrivals: [string, keyof typeof PLACES, "ARRIVAL" | "DEPARTURE", Date][] = [
    ["sofia", "home", "DEPARTURE", earlier(7, 38)],
    ["sofia", "school", "ARRIVAL", earlier(8, 2)],
    ["maria", "home", "DEPARTURE", earlier(8, 11)],
    ["carlos", "home", "DEPARTURE", earlier(8, 15)],
    ["maria", "work", "ARRIVAL", earlier(8, 47)],
    ["carlos", "work", "DEPARTURE", minutesAgo(22)],
  ]
  for (const [who, pk, type, when] of arrivals) {
    await sql`
      INSERT INTO geofence_events (id, saved_place_id, user_id, event_type, latitude, longitude, timestamp)
      VALUES (${id()}, ${place[pk]}, ${user[who]}, ${type}, ${PLACES[pk].lat}, ${PLACES[pk].lng}, ${when.toISOString()})
    `
  }

  // ---- calendar: 12 events over about four weeks, member colors ----
  const calendarId = id()
  await sql`
    INSERT INTO calendars (id, family_id, name, color, is_shared, is_default, created_at, updated_at)
    VALUES (${calendarId}, ${familyId}, 'Family Calendar', '#3B82F6', true, true, NOW(), NOW())
  `
  type Ev = { title: string; start: Date; mins: number; who: string[]; by?: string; place?: keyof typeof PLACES; allDay?: boolean; color: string }
  const events: Ev[] = [
    { title: "Soccer practice", start: at(thisWeek(2) - 14, 17, 30), mins: 90, who: ["sofia"], place: "field", color: "#8B5CF6" },
    { title: "Soccer practice", start: at(thisWeek(4) - 7, 17, 30), mins: 90, who: ["sofia"], place: "field", color: "#8B5CF6" },
    { title: "Soccer practice", start: at(thisWeek(2), 17, 30), mins: 90, who: ["sofia"], place: "field", color: "#8B5CF6" },
    { title: "Piano lesson", start: at(thisWeek(3) - 14, 16, 0), mins: 45, who: ["mateo"], color: "#F97316" },
    { title: "Piano lesson", start: at(thisWeek(3), 16, 0), mins: 45, who: ["mateo"], color: "#F97316" },
    { title: "Art class", start: at(0, 15, 30), mins: 60, who: ["mateo"], color: "#F97316" },
    { title: "Dentist: Mateo", start: at(2, 10, 0), mins: 60, who: ["maria", "mateo"], color: "#3B82F6" },
    { title: "Parent-teacher night", start: at(-17, 18, 30), mins: 90, who: ["maria", "carlos"], place: "school", color: "#3B82F6" },
    { title: "Family dinner at Abuela's", start: at(nextDow(0), 17, 0), mins: 120, who: ["maria", "carlos", "sofia", "mateo", "rosa"], by: "rosa", color: "#EC4899" },
    { title: "Family dinner", start: at(nextDow(0) - 14, 17, 0), mins: 120, who: ["maria", "carlos", "sofia", "mateo", "rosa"], color: "#EC4899" },
    { title: "Bike ride by the river", start: at(-5, 10, 0), mins: 120, who: ["carlos", "mateo"], by: "carlos", color: "#10B981" },
    { title: "Birthday: Mateo 🎂", start: at(6, 0), mins: 24 * 60, who: ["mateo"], allDay: true, color: "#F97316" },
  ]
  for (const e of events) {
    const eventId = id()
    await sql`
      INSERT INTO events (id, calendar_id, created_by_id, title, location, saved_place_id, start_time, end_time,
        is_all_day, status, visibility, color, reminder_minutes, created_at, updated_at)
      VALUES (${eventId}, ${calendarId}, ${user[e.by ?? "maria"]}, ${e.title}, ${e.place ? PLACES[e.place].name : null},
        ${e.place ? place[e.place] : null}, ${e.start.toISOString()}, ${new Date(e.start.getTime() + e.mins * 60_000).toISOString()},
        ${!!e.allDay}, 'APPROVED', 'FAMILY', ${e.color}, ${[15, 60]}, ${at(-7, 9).toISOString()}, NOW())
    `
    for (const w of e.who) {
      await sql`
        INSERT INTO event_participants (id, event_id, user_id, child_profile_id, status, responded_at, created_at, updated_at)
        VALUES (${id()}, ${eventId}, ${user[w] ?? null}, ${user[w] ? null : child[w]}, 'ACCEPTED', NOW(), NOW(), NOW())
      `
    }
  }

  // ---- tasks: 8, some done ----
  type Task = { title: string; to: string; due: Date; done?: boolean; category?: string; priority?: string }
  const tasks: Task[] = [
    { title: "Take out recycling", to: "mateo", due: at(0, 19, 0) },
    { title: "Pack soccer bag", to: "sofia", due: at(0, 17, 0), category: "SCHOOL" },
    { title: "Math homework", to: "sofia", due: at(0, 21, 0), done: true, category: "HOMEWORK" },
    { title: "Grocery run", to: "carlos", due: at(0, 18, 0), category: "ERRAND" },
    { title: "Call the dentist", to: "maria", due: at(0, 12, 0), done: true, category: "ERRAND" },
    { title: "Pick up dry cleaning", to: "carlos", due: at(1, 17, 0), category: "ERRAND" },
    { title: "Feed the cat", to: "mateo", due: at(0, 8, 0), done: true },
    { title: "Bake cookies for Mateo's party", to: "rosa", due: at(5, 15, 0), priority: "HIGH" },
  ]
  for (const t of tasks) {
    const kid = !user[t.to]
    await sql`
      INSERT INTO tasks (id, family_id, created_by_id, assigned_to_id, child_profile_id, title, category, priority,
        due_date, status, completed_at, completed_by_id, created_at, updated_at)
      VALUES (${id()}, ${familyId}, ${user.maria}, ${kid ? null : user[t.to]}, ${kid ? child[t.to] : null}, ${t.title},
        ${t.category ?? "CHORE"}, ${t.priority ?? "NORMAL"}, ${t.due.toISOString()}, ${t.done ? "COMPLETED" : "PENDING"},
        ${t.done ? minutesAgo(90).toISOString() : null}, ${t.done ? (user[t.to] ?? user.maria) : null},
        ${at(-2, 19).toISOString()}, NOW())
    `
  }

  // ---- reminders: 5, all upcoming ----
  const reminders: [string, string | null, Date, string?][] = [
    ["Buy birthday gift for Mateo", null, at(2, 10, 0)],
    ["Permission slip due Friday", "Sofia's field trip", at(nextDow(5), 7, 30), "sofia"],
    ["Refill prescription", null, at(1, 9, 0)],
    ["Return library books", null, at(3, 15, 30), "mateo"],
    ["Bring cleats to practice", null, at(nextDow(2), 7, 15), "sofia"],
  ]
  for (const [title, description, when, forKey] of reminders) {
    await sql`
      INSERT INTO reminders (id, family_id, user_id, created_by_id, title, description, remind_at, status,
        notify_channels, child_profile_id, created_at, updated_at)
      VALUES (${id()}, ${familyId}, ${forKey && user[forKey] ? user[forKey] : user.maria}, ${user.maria}, ${title},
        ${description}, ${when.toISOString()}, 'PENDING', ${["in_app", "push"]},
        ${forKey && !user[forKey] ? child[forKey] : null}, ${at(-1, 20).toISOString()}, NOW())
    `
  }

  // ---- board: a pinned note and 5 messages ----
  const posts: [string, string, boolean, Date][] = [
    ["maria", "Pizza Friday! 🍕 Everyone home by 6. Abuela is bringing dessert.", true, at(-2, 19, 4)],
    ["rosa", "Making arroz con pollo Sunday. Who's coming? 💛", false, minutesAgo(26 * 60)],
    ["sofia", "Can someone sign my field trip permission slip tonight?", false, minutesAgo(19 * 60)],
    ["maria", "So proud of Mateo, he read three chapters on his own last night! 📚", false, minutesAgo(14 * 60)],
    ["sofia", "Saturday's game moved to 10 AM ⚽", false, minutesAgo(5 * 60)],
    ["carlos", "Traffic's light, I'll grab groceries on the way home. Need anything else?", false, minutesAgo(20)],
  ]
  for (const [who, body, pinned, when] of posts) {
    const postId = id()
    await sql`
      INSERT INTO family_posts (id, family_id, user_id, body, pinned, created_at)
      VALUES (${postId}, ${familyId}, ${user[who]}, ${body}, ${pinned}, ${when.toISOString()})
    `
    if (who === "carlos") {
      await sql`
        INSERT INTO family_post_comments (id, post_id, family_id, user_id, body, created_at)
        VALUES (${id()}, ${postId}, ${familyId}, ${user.maria}, 'Bananas and milk, thank you! 🙌', ${minutesAgo(12).toISOString()})
      `
    }
  }
  await sql`UPDATE family_members SET board_last_seen_at = NOW() WHERE family_id = ${familyId}`

  // ---- a couple of fresh, unread notifications for Maria ----
  const notes: [string, string, string, Record<string, unknown>, Date][] = [
    ["GEOFENCE_ALERT", "Sofia arrived at School", "Sofia arrived at School", { placeName: "School" }, earlier(8, 2)],
    ["TASK_COMPLETED", "Task Completed", 'Sofia completed the task: "Math homework"', {}, minutesAgo(90)],
  ]
  for (const [type, title, body, data, when] of notes) {
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at)
      VALUES (${id()}, ${user.maria}, ${type}, ${title}, ${body}, ${JSON.stringify({ ...data, familyId })}::jsonb, false, ${when.toISOString()})
    `
  }

  fs.writeFileSync(ENV_FILE, `# Demo family owner (scripts/demo). Dev branch only.\nDEMO_EMAIL=${OWNER_EMAIL}\nDEMO_PASSWORD=${password}\n`)
  console.log(`Seeded "The Rivera Family": ${PEOPLE.length} members, ${Object.keys(PLACES).length} places, ${events.length} events, ${tasks.length} tasks, ${reminders.length} reminders, ${posts.length} board posts.`)
  console.log(`Sign in as ${OWNER_EMAIL}; the password is in .env.demo.local.`)
}

const resetOnly = process.argv.includes("--reset")
;(resetOnly ? reset().then((n) => console.log(n ? "Removed the demo family." : "No demo family to remove.")) : seed())
  .catch((e) => {
    console.error("Demo seed failed:", e instanceof Error ? e.message : e)
    process.exit(1)
  })
