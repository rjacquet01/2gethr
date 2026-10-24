// Usage: npx tsx --tsconfig tsconfig.json scripts/test-device-token-claim.ts
// Background-sharing tokens handed to the Android app (lib/device-token.ts).
// App 1.2.6+ claims a token, which locks it until the website confirms it,
// signed in as the token's owner. A token from another account (someone sent a
// togethr-bg:// link carrying their own token) is revoked and never works.
// Tokens never claimed (older apps) keep working. In-memory fake database
// (lib/db __setSqlForTests): no database, no network.
import assert from "node:assert"
import crypto from "node:crypto"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "device-claim-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "device-claim-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET ||= "device-claim-test-placeholder-not-used"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = {
  user_id: string; family_member_id: string; family_id: string; token_hash: string
  claim_hash: string | null; claimed_at: number | null; confirmed_at: number | null; revoked_at: number | null
}
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex")
const usable = (r: Row) => r.revoked_at === null && (r.claimed_at === null || r.confirmed_at !== null)

async function main() {
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const dt = await import("../lib/device-token")
  const claimRoute = await import("../app/api/location/device-token/claim/route")
  const confirmRoute = await import("../app/api/location/device-token/confirm/route")

  const rows: Row[] = []
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    const now = Date.now()
    if (q.startsWith("INSERT INTO location_device_tokens")) {
      rows.push({ user_id: String(v[1]), family_member_id: String(v[2]), family_id: String(v[3]), token_hash: String(v[4]), claim_hash: null, claimed_at: null, confirmed_at: null, revoked_at: null })
      return []
    }
    if (q.startsWith("UPDATE location_device_tokens SET revoked_at = NOW() WHERE user_id")) {
      for (const r of rows) if (r.user_id === v[0] && r.family_member_id === v[1] && r.revoked_at === null) r.revoked_at = now
      return []
    }
    if (q.startsWith("UPDATE location_device_tokens SET last_used_at")) {
      const r = rows.find((x) => x.token_hash === v[0] && usable(x))
      return r ? [r] : []
    }
    if (q.startsWith("UPDATE location_device_tokens SET claim_hash")) {
      const r = rows.find((x) => x.token_hash === v[1] && x.revoked_at === null && x.confirmed_at === null)
      if (!r) return []
      r.claim_hash = String(v[0]); r.claimed_at = now
      return [r]
    }
    if (q.startsWith("UPDATE location_device_tokens SET confirmed_at")) {
      const r = rows.find((x) => x.claim_hash === v[0] && x.user_id === v[1] && x.revoked_at === null && x.confirmed_at === null
        && x.claimed_at !== null && x.claimed_at > now - Number(v[2]) * 60_000)
      if (!r) return []
      r.confirmed_at = now; r.claim_hash = null
      return [r]
    }
    if (q.startsWith("UPDATE location_device_tokens SET revoked_at = NOW(), claim_hash = NULL")) {
      const hit = rows.filter((x) => x.claim_hash === v[0] && x.user_id !== v[1] && x.revoked_at === null)
      for (const r of hit) { r.revoked_at = now; r.claim_hash = null }
      return hit.map(() => ({ id: "x" }))
    }
    if (q.startsWith("SELECT created_at, last_used_at FROM location_device_tokens")) {
      return rows.filter((x) => x.user_id === v[0] && x.family_member_id === v[1] && usable(x)).map(() => ({ created_at: new Date(), last_used_at: null }))
    }
    if (q.includes("FROM users") && q.includes("WHERE id =")) return [{ id: v[0], email: `${v[0]}@example.invalid`, first_name: "Test", is_active: true, role: "USER" }]
    if (q.startsWith("SELECT name FROM families")) return [{ name: v[0] === "fam-a" ? "Ace family" : "Mallory family" }]
    if (q.includes("AS name FROM family_members fm")) return [{ name: v[1] === "u-alice" ? "Alice" : "Mallory" }]
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const claim = async (token: string) => {
    const res = await claimRoute.POST(new Request("http://localhost/api/location/device-token/claim", {
      method: "POST", headers: { "x-device-token": token },
    }) as never)
    return { status: res.status, json: await res.json() }
  }
  const confirm = async (userId: string, code: string) => {
    const bearer = await generateAccessToken(userId)
    const res = await confirmRoute.POST(new Request("http://localhost/api/location/device-token/confirm", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify({ code }),
    }) as never)
    return { status: res.status, json: await res.json() }
  }

  // An older app never claims: its token works as before.
  const legacy = await dt.issueDeviceToken("u-alice", "m-alice", "fam-a")
  assert.ok(await dt.verifyDeviceToken(legacy))
  ok("unclaimed token (app 1.2.5 and older) keeps working")

  // App 1.2.6: claim names the owner, then the token is locked until confirmed.
  const token = await dt.issueDeviceToken("u-alice", "m-alice", "fam-a")
  let r = await claim(token)
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.name, "Alice")
  assert.equal(r.json.familyName, "Ace family")
  assert.match(r.json.code, /^[0-9a-f]{48}$/)
  assert.equal(await dt.verifyDeviceToken(token), null, "claimed, unconfirmed token is refused")
  assert.equal((await dt.getDeviceTokenStatus("u-alice", "m-alice")).active, false)
  ok("claim returns the owner's name and family; token unusable until confirmed")

  // Confirmed by the same account: works.
  const res = await confirm("u-alice", r.json.code)
  assert.equal(res.status, 200, JSON.stringify(res.json))
  assert.equal(res.json.name, "Alice")
  assert.ok(await dt.verifyDeviceToken(token))
  assert.equal((await confirm("u-alice", r.json.code)).status, 410, "a code works once")
  assert.equal((await claim(token)).status, 401, "a confirmed token can't be re-claimed")
  ok("owner confirms on the phone: token works; the code is single-use")

  // The hijack: Mallory sends Alice a link carrying Mallory's token. Alice's app
  // claims it; the confirm page runs signed in as Alice and refuses it.
  const evil = await dt.issueDeviceToken("u-mallory", "m-mallory", "fam-m")
  r = await claim(evil)
  assert.equal(r.status, 200)
  assert.equal(r.json.name, "Mallory", "the disclosure shows whose sharing it is")
  const refused = await confirm("u-alice", r.json.code)
  assert.equal(refused.status, 403)
  assert.equal(refused.json.code, "OTHER_ACCOUNT")
  assert.equal(await dt.verifyDeviceToken(evil), null)
  assert.equal((await confirm("u-mallory", r.json.code)).status, 410, "revoked: not even its owner can confirm it now")
  assert.equal(await dt.verifyDeviceToken(evil), null)
  ok("token from another account: refused (403) and revoked, so it never reports a location")

  // Expired claim (older than CLAIM_MINUTES).
  const late = await dt.issueDeviceToken("u-alice", "m-alice2", "fam-a")
  r = await claim(late)
  rows.find((x) => x.token_hash === hash(late))!.claimed_at = Date.now() - (dt.CLAIM_MINUTES + 1) * 60_000
  assert.equal((await confirm("u-alice", r.json.code)).status, 410)
  assert.equal(await dt.verifyDeviceToken(late), null)
  ok(`claim older than ${dt.CLAIM_MINUTES} minutes can't be confirmed`)

  assert.equal((await claim("tgd_" + "0".repeat(64))).status, 401)
  assert.equal((await confirm("u-alice", "not-a-code")).status, 400)
  ok("unknown token (401) and malformed code (400)")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
