// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-auth-hardening.ts
// Admin sign-in hardening (security review 2026-11-10 #1, #2, #9):
//  - clientIp ignores the client-controlled first x-forwarded-for entry.
//  - Admin login is rate limited per email (10 / 15 min, unknown emails too)
//    and per IP (20 / 15 min), on top of the per-account lockout.
//  - Turning two-factor off needs the password AND a current or backup code,
//    5 tries per 15 minutes.
// In-memory fake database (lib/db __setSqlForTests): no database, no network,
// no email (RESEND_API_KEY removed before anything loads).
import assert from "node:assert"
import bcrypt from "bcryptjs"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "admin-hardening-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "admin-hardening-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "admin-hardening-test-admin-secret-not-real-0123456789"
delete process.env.RESEND_API_KEY

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { clientIp } = await import("../lib/rate-limit")
  const req = (h: Record<string, string>) => new Request("http://localhost/x", { headers: h })
  assert.strictEqual(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })), "203.0.113.9")
  assert.strictEqual(clientIp(req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.7" })), "198.51.100.7")
  assert.strictEqual(clientIp(req({ "x-vercel-forwarded-for": "192.0.2.1", "x-real-ip": "198.51.100.7", "x-forwarded-for": "9.9.9.9" })), "192.0.2.1")
  assert.strictEqual(clientIp(req({})), "unknown")
  ok("client IP: Vercel's header, then x-real-ip, then the last forwarded hop; a spoofed first entry is ignored")

  const { __setSqlForTests } = await import("../lib/db")
  const { NextRequest } = await import("next/server")
  const { hashBackupCode } = await import("../lib/totp")
  const { generateAdminAccessToken } = await import("../lib/admin-auth")
  const login = await import("../app/api/admin/auth/login/route")
  const mfa = await import("../app/api/admin/auth/mfa/route")

  const hits = new Map<string, number>()
  const passwordHash = await bcrypt.hash("right-password", 4)
  let backupCodes = [hashBackupCode("BACK-UP01")]
  let mfaEnabled = true
  const actions: string[] = []
  __setSqlForTests((async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    if (q.includes("INSERT INTO rate_limit_hits")) {
      const key = String(v[0])
      const n = hits.get(key) ?? 0
      hits.set(key, n + 1)
      return [{ n, oldest: new Date().toISOString() }]
    }
    if (q.startsWith("SELECT id, email, first_name, last_name, status, mfa_enabled FROM admin_users")) {
      return v[0] === "adm-1" ? [{ id: "adm-1", email: "admin@example.invalid", first_name: "A", last_name: "D", status: "ACTIVE", mfa_enabled: mfaEnabled }] : []
    }
    if (q.includes("FROM admin_users") && q.includes("WHERE email")) return [] // no such account: "Invalid credentials"
    if (q.startsWith("SELECT password_hash FROM admin_users")) return [{ password_hash: passwordHash }]
    if (q.startsWith("SELECT mfa_secret_enc, mfa_backup_codes FROM admin_users")) return [{ mfa_secret_enc: "not-used-for-backup-codes", mfa_backup_codes: backupCodes }]
    if (q.startsWith("UPDATE admin_users SET mfa_backup_codes = array_remove")) { backupCodes = backupCodes.filter((c) => c !== v[0]); return [] }
    if (q.includes("mfa_enabled = false") || (q.startsWith("UPDATE admin_users") && q.includes("mfa_secret_enc = NULL"))) { mfaEnabled = false; return [] }
    if (q.includes("INSERT INTO admin_action_logs") || q.includes("INSERT INTO audit")) { actions.push(String(v.find((x) => typeof x === "string" && /^MFA_/.test(x)) ?? "")); return [] }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0])

  const tryLogin = async (email: string, xff: string) => {
    const res = await login.POST(new NextRequest("http://localhost/api/admin/auth/login", {
      method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": xff },
      body: JSON.stringify({ email, password: "guess" }),
    }))
    return res.status
  }

  // Per email: 10 tries, then 429, even for an address with no account.
  for (let i = 0; i < 10; i++) assert.strictEqual(await tryLogin("target@example.invalid", `10.0.0.${i}, 203.0.113.${i}`), 401)
  assert.strictEqual(await tryLogin("target@example.invalid", "10.9.9.9, 203.0.113.200"), 429)
  ok("11th guess at one admin email in 15 min: 429 (from any IP)")

  // Per IP: rotating the spoofable first entry doesn't help; the real hop counts.
  hits.clear()
  const statuses: number[] = []
  for (let i = 0; i < 21; i++) statuses.push(await tryLogin(`user${i}@example.invalid`, `${i}.${i}.${i}.${i}, 203.0.113.50`))
  assert.deepStrictEqual(statuses.slice(0, 20).every((s) => s === 401), true)
  assert.strictEqual(statuses[20], 429)
  ok("21st guess from one address across different emails: 429, spoofed x-forwarded-for ignored")

  // Two-factor off: password AND code.
  const token = await generateAdminAccessToken({ id: "adm-1", email: "admin@example.invalid", firstName: "A", lastName: "D", status: "ACTIVE", mfaEnabled: true, roles: [], permissions: [] })
  const disable = async (body: Record<string, unknown>) => {
    const res = await mfa.POST(new NextRequest("http://localhost/api/admin/auth/mfa", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ action: "disable", ...body }),
    }))
    return { status: res.status, body: await res.json() }
  }
  hits.clear()
  let r = await disable({ password: "right-password" })
  assert.strictEqual(r.status, 403)
  assert.strictEqual(mfaEnabled, true)
  r = await disable({ password: "wrong", code: "BACK-UP01" })
  assert.strictEqual(r.status, 403)
  assert.strictEqual(r.body.error, "Wrong password or code")
  assert.strictEqual(backupCodes.length, 1, "a wrong password must not spend the backup code")
  ok("password alone, or a code with the wrong password: refused, same message, nothing spent")

  r = await disable({ password: "right-password", code: "BACK-UP01" })
  assert.strictEqual(r.status, 200)
  assert.strictEqual(mfaEnabled, false)
  ok("password plus a valid backup code: two-factor turned off")

  mfaEnabled = true
  hits.clear()
  for (let i = 0; i < 5; i++) assert.strictEqual((await disable({ password: `guess-${i}`, code: "000000" })).status, 403)
  assert.strictEqual((await disable({ password: "right-password", code: "000000" })).status, 429)
  ok("6th try to turn it off within 15 min: 429")

  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
