// Usage: npx tsx --tsconfig tsconfig.json scripts/test-admin-reports-address.ts
// Operational/system reports go to the admin mailbox (admin@mytogethr.com)
// unless ADMIN_EMAIL overrides it, and the weekly digest summary template.
import assert from "node:assert"
import { DEFAULT_ADMIN_EMAIL, EMAIL_TEMPLATES, resolveAdminEmail } from "../lib/services/email"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

assert.strictEqual(DEFAULT_ADMIN_EMAIL, "admin@mytogethr.com")
ok("default admin address is admin@mytogethr.com")
assert.strictEqual(resolveAdminEmail(undefined), "admin@mytogethr.com")
ok("no ADMIN_EMAIL: uses the admin mailbox")
assert.strictEqual(resolveAdminEmail(""), "admin@mytogethr.com")
assert.strictEqual(resolveAdminEmail("   "), "admin@mytogethr.com")
ok("empty or blank ADMIN_EMAIL falls back to the admin mailbox")
assert.strictEqual(resolveAdminEmail(" ops@example.test "), "ops@example.test")
ok("an explicit ADMIN_EMAIL still overrides (trimmed)")

const good = EMAIL_TEMPLATES.ADMIN_WEEKLY_DIGEST_SUMMARY({ total: 10, sent: 8, failed: 0, skipped: 2, weekLabel: "Nov 1 - Nov 8" })
assert.match(good.subject, /^Weekly digest sent: 8 of 10 \(Nov 1 - Nov 8\)$/)
assert.match(good.text, /Sent: 8/)
assert.match(good.html, /Skipped/)
ok("weekly digest summary: clean run")
const bad = EMAIL_TEMPLATES.ADMIN_WEEKLY_DIGEST_SUMMARY({ total: 10, sent: 7, failed: 1, skipped: 2, weekLabel: "Nov 1 - Nov 8" })
assert.match(bad.subject, /finished with failures: 7 of 10/)
ok("weekly digest summary: failures called out in the subject")
const xss = EMAIL_TEMPLATES.ADMIN_WEEKLY_DIGEST_SUMMARY({ total: 1, sent: 1, failed: 0, skipped: 0, weekLabel: "<script>x</script>" })
assert.ok(!xss.html.includes("<script>"))
ok("week label is HTML-escaped")

console.log(`\nAll ${passed} admin report checks passed.`)
