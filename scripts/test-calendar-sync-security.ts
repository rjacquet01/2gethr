// Usage: npx tsx --tsconfig tsconfig.json scripts/test-calendar-sync-security.ts
// Calendar sync hardening (security review 2026-11-10):
//  - lib/safe-fetch.ts: iCal import fetches only https on 443 at public
//    addresses (literal IPs and DNS answers both checked, before connecting).
//  - Google connect: the OAuth state only verifies with the nonce cookie set
//    in the browser that started the flow.
//  - iCal import: grown-ups only, needs create-events, and goes through
//    approval when the member's events need approving.
// No network: DNS is replaced and every fetch stops at the address check.
// In-memory fake database (lib/db __setSqlForTests).
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "calsync-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "calsync-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "calsync-test-placeholder-not-used"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Bake sale\r\nDTSTART:20261201T150000Z\r\nDTEND:20261201T160000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"

async function main() {
  const sf = await import("../lib/safe-fetch")

  // --- addresses
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1",
    "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::10.0.0.1"]) {
    assert.strictEqual(sf.isPublicIp(ip), false, ip)
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.strictEqual(sf.isPublicIp(ip), true, ip)
  assert.strictEqual(sf.isPublicIp("not-an-ip"), false)
  ok("private, loopback, link-local (metadata), CGNAT, multicast, IPv6 and mapped forms refused; public allowed")

  // --- URLs
  const bad = ["http://example.com/a.ics", "ftp://example.com/a.ics", "https://example.com:8443/a.ics", "https://u:p@example.com/a.ics",
    "https://127.0.0.1/a.ics", "https://[::1]/a.ics", "https://169.254.169.254/latest", "not a url", "file:///etc/passwd"]
  for (const u of bad) assert.throws(() => sf.checkFetchUrl(u), sf.UnsafeUrlError, u)
  assert.strictEqual(sf.checkFetchUrl("webcal://calendar.example.com/x.ics").protocol, "https:")
  assert.strictEqual(sf.checkFetchUrl("https://calendar.example.com:443/x.ics").hostname, "calendar.example.com")
  ok("https/webcal on 443 only; http, other ports, credentials, internal literal IPs refused")

  // --- DNS answers are checked before any connection
  const asked: string[] = []
  sf.__setResolverForTests((host, cb) => {
    asked.push(host)
    if (host === "internal.example") return cb(null, [{ address: "10.0.0.5", family: 4 }])
    if (host === "mixed.example") return cb(null, [{ address: "93.184.215.14", family: 4 }, { address: "127.0.0.1", family: 4 }])
    cb(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), [])
  })
  for (const host of ["internal.example", "mixed.example"]) {
    await assert.rejects(sf.fetchPublicUrl(`https://${host}/cal.ics`, { maxBytes: 1000, timeoutMs: 3000 }), (e: unknown) =>
      e instanceof sf.UnsafeUrlError && !/10\.0\.0\.5|127\.0\.0\.1|ENOTFOUND/.test((e as Error).message))
  }
  await assert.rejects(sf.fetchPublicUrl("https://nowhere.example/cal.ics", { maxBytes: 1000, timeoutMs: 3000 }), sf.UnsafeUrlError)
  assert.deepStrictEqual(asked.slice(0, 3), ["internal.example", "mixed.example", "nowhere.example"])
  sf.__setResolverForTests(null)
  ok("a name resolving to any private address is refused at connect time; errors stay generic")

  // --- Google OAuth state bound to the browser
  const auth = await import("../lib/auth")
  const state = await auth.generateOAuthState("u-victim", "nonce-123")
  assert.strictEqual(await auth.verifyOAuthState(state, "nonce-123"), "u-victim")
  assert.strictEqual(await auth.verifyOAuthState(state, undefined), null)
  assert.strictEqual(await auth.verifyOAuthState(state, "nonce-999"), null)
  assert.strictEqual(await auth.verifyOAuthState("forged.state.value", "nonce-123"), null)
  ok("OAuth state verifies only with the matching nonce cookie (another browser's link fails)")

  // --- iCal import permissions
  const { __setSqlForTests } = await import("../lib/db")
  const route = await import("../app/api/calendar-sync/ical/import/route")
  type M = { role: string; can_create_events: boolean; requires_event_approval: boolean }
  const members: Record<string, M> = {
    "u-parent": { role: "PARENT", can_create_events: false, requires_event_approval: false },
    "u-adult": { role: "ADULT", can_create_events: true, requires_event_approval: false },
    "u-adult-noperm": { role: "ADULT", can_create_events: false, requires_event_approval: false },
    "u-adult-approve": { role: "ADULT", can_create_events: true, requires_event_approval: true },
    "u-kid": { role: "CHILD", can_create_events: true, requires_event_approval: false },
    "u-guest": { role: "GUEST", can_create_events: true, requires_event_approval: false },
  }
  const events: { status: string; by: string }[] = []
  const requests: string[] = []
  __setSqlForTests((async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "T", is_active: true, role: "USER" }]
    if (q.startsWith("SELECT family_id, role FROM family_members")) { const m = members[String(v[1])]; return m ? [{ family_id: v[0], role: m.role }] : [] }
    if (q.startsWith("SELECT can_create_events, requires_event_approval FROM family_members")) { const m = members[String(v[1])]; return m ? [m] : [] }
    if (q.startsWith("SELECT id FROM calendars")) return [{ id: "cal-1" }]
    if (q.startsWith("INSERT INTO ics_import_records")) return [{ id: "claim" }]
    if (q.startsWith("INSERT INTO events")) { events.push({ status: String(v[7]), by: String(v[9]) }); return [{ id: `ev-${events.length}` }] }
    if (q.startsWith("INSERT INTO event_requests")) { requests.push(String(v[1])); return [] }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0])

  const imp = async (userId: string) => {
    const form = new FormData()
    form.append("file", new File([ICS], "school.ics", { type: "text/calendar" }))
    const { NextRequest } = await import("next/server")
    const res = await route.POST(new NextRequest("http://localhost/api/calendar-sync/ical/import?familyId=fam-a", {
      method: "POST", headers: { authorization: `Bearer ${await auth.generateAccessToken(userId)}` }, body: form,
    }))
    return res.status
  }

  for (const u of ["u-kid", "u-guest", "u-adult-noperm"]) assert.strictEqual(await imp(u), 403, u)
  assert.strictEqual(events.length, 0)
  ok("child, guest and an adult without create-events: 403, nothing imported")

  assert.strictEqual(await imp("u-parent"), 200)
  assert.strictEqual(await imp("u-adult"), 200)
  assert.deepStrictEqual(events.map((e) => e.status), ["APPROVED", "APPROVED"])
  assert.strictEqual(requests.length, 0)
  ok("parent and permitted adult: imported as approved")

  assert.strictEqual(await imp("u-adult-approve"), 200)
  assert.strictEqual(events[2].status, "PENDING")
  assert.deepStrictEqual(requests, ["ev-3"])
  ok("adult whose events need approval: imported as PENDING with an approval request")

  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
