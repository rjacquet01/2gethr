// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-created-email.ts
// New admin / super admin accounts: a summary to admin@mytogethr.com and a
// confirmation to the new admin, never with the password. No database; Resend
// is a fake fetch, so nothing is sent.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.RESEND_API_KEY = "re_test_placeholder_never_called"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const { adminCreatedEmails, sendAdminCreatedEmails, ADMIN_MAILBOX } = await import("../lib/admin-created-email")
  const admin = { email: "new.admin@example.invalid", firstName: "Pat", lastName: "<Lee>", role: "SUPER_ADMIN" }
  const at = new Date("2026-11-02T20:30:00Z")

  const { summary, confirmation } = adminCreatedEmails(admin, "Ray J (ray@example.invalid)", at)
  assert.equal(ADMIN_MAILBOX, "admin@mytogethr.com")
  assert.equal(summary.to, "admin@mytogethr.com")
  assert.equal(confirmation.to, admin.email)
  assert.equal(summary.subject, "New Super Admin account: Pat <Lee>")
  assert.equal(confirmation.subject, "Your Togethr Super Admin account was created")
  for (const m of [summary, confirmation]) {
    assert.ok(m.text.includes("Created by: Ray J (ray@example.invalid)"))
    assert.ok(m.text.includes("Created: Nov 2, 2026, 3:30 PM ET"))
    assert.ok(m.html.includes("&lt;Lee&gt;") && !m.html.includes("<Lee>"), "names escaped in html")
  }
  assert.ok(confirmation.text.includes("/admin/login"))
  ok("summary to the admin mailbox, confirmation to the new admin")

  assert.ok(adminCreatedEmails({ ...admin, role: "ADMIN" }, null, at).summary.text.includes("Role: Admin\nCreated by: First-time setup"))
  ok("plain admin role, and the first-time setup page")

  const sent: { to: string; body: string }[] = []
  let fail = false
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    assert.ok(String(url).includes("api.resend.com"))
    const body = JSON.parse(String(init?.body))
    sent.push({ to: [].concat(body.to).join(), body: String(init?.body) })
    if (fail) throw new Error("network down")
    return new Response(JSON.stringify({ id: "e1" }), { status: 200 })
  }) as typeof fetch
  await sendAdminCreatedEmails(admin, "Ray J (ray@example.invalid)")
  assert.deepEqual(sent.map((s) => s.to).sort(), ["admin@mytogethr.com", admin.email].sort())
  ok("both sent through Resend")

  fail = true
  const realError = console.error
  console.error = () => {}
  try { await sendAdminCreatedEmails(admin, null) } finally { console.error = realError }
  ok("a failed send never throws (the account already exists)")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
