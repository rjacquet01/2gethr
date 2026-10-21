// Usage: npx tsx --tsconfig tsconfig.json scripts/test-member-names.ts
// One name per family member (lib/member-names.ts): the rule itself, every
// SQL copy of it, the profile/nickname syncing, and the "Name shown to this
// family" route. Routes run on an in-memory fake database (lib/db
// __setSqlForTests); nothing touches a real database.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.JWT_ACCESS_SECRET = "names-test-access-secret-not-real-0123456789"
process.env.JWT_REFRESH_SECRET = "names-test-refresh-secret-not-real-0123456789"
process.env.ADMIN_JWT_SECRET = "names-test-admin-secret-not-real-0123456789"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
type Row = Record<string, unknown>

async function main() {
  const names = await import("../lib/member-names")
  const { memberName, MEMBER_NAME_SQL, taskAssigneeName, participantName } = names

  console.log("the rule")
  {
    assert.strictEqual(memberName({ role: "PARENT", nickname: "Mom", firstName: "Mia", lastName: "Lee" }), "Mom")
    assert.strictEqual(memberName({ role: "PARENT", nickname: null, firstName: "Mia", lastName: "Lee" }), "Mia")
    assert.strictEqual(memberName({ role: "PARENT", nickname: "   ", firstName: " Mia ", lastName: "Lee" }), "Mia")
    ok("adult: nickname if set (blank or spaces count as unset), else first name")

    assert.strictEqual(memberName({ role: "PARENT", firstName: "Mia", lastName: "Lee" }, { withLastName: true }), "Mia Lee")
    assert.strictEqual(memberName({ role: "PARENT", firstName: "Mia", lastName: "Lee" }), "Mia")
    assert.strictEqual(memberName({ role: "PARENT", nickname: "Mom", lastName: "Lee" }, { withLastName: true }), "Mom")
    ok("last name only where asked for, never added to a nickname")

    assert.strictEqual(memberName({ role: "CHILD", nickname: "Kitty", childDisplayName: "Kit", firstName: "Katherine" }), "Kit")
    assert.strictEqual(memberName({ role: "CHILD", nickname: "Kitty", childDisplayName: " ", firstName: "Katherine" }), "Kitty")
    assert.strictEqual(memberName({ role: "CHILD", firstName: "Katherine", lastName: "Lee" }, { withLastName: true }), "Katherine Lee")
    ok("child: the profile name a parent gave beats an old nickname, then nickname, then login name")

    assert.strictEqual(memberName({ role: "ADULT", nickname: "Kat", childDisplayName: "Kit (old child profile)", firstName: "Katherine" }), "Kat")
    assert.strictEqual(memberName({ role: "ADULT", childDisplayName: "Kit", firstName: "Katherine" }), "Katherine")
    ok("an adult's leftover child profile (promoted at 18) is ignored")

    assert.strictEqual(memberName({}), "Family member")
    assert.strictEqual(memberName({ role: "PARENT" }, { fallback: "A parent" }), "A parent")
    assert.strictEqual(memberName({ role: "PARENT" }, { fallback: "" }), "")
    assert.strictEqual(memberName({ role: "PARENT", firstName: 42 as unknown as string }), "Family member")
    ok("no name: the fallback (an explicit empty fallback is kept)")

    assert.strictEqual(taskAssigneeName({ child_display_name: "Kit", assigned_to_id: null }), "Kit")
    assert.strictEqual(taskAssigneeName({ assigned_to_id: null }), null)
    assert.strictEqual(taskAssigneeName({ assigned_to_id: "u1", assignee_role: "PARENT", assignee_nickname: "Dad", assignee_first_name: "Dan", assignee_last_name: "Lee" }), "Dad")
    assert.strictEqual(taskAssigneeName({ assigned_to_id: "u2", assignee_role: "CHILD", assignee_child_name: "Kit", assignee_first_name: "Katherine", assignee_last_name: "Lee" }), "Kit")
    assert.strictEqual(participantName({ child_name: "Kit" }), "Kit")
    assert.strictEqual(participantName({ role: "GUARDIAN", nickname: "Nana", first_name: "Ann", last_name: "Lee" }), "Nana")
    ok("task assignees and event participants follow the same rule")
  }

  console.log("SQL copies")
  {
    const copies: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(e.name)) {
          const text = fs.readFileSync(p, "utf8")
          let i = text.indexOf("CASE WHEN fm.role = 'CHILD'")
          while (i >= 0) {
            copies.push(`${p}::${text.slice(i, i + MEMBER_NAME_SQL.length)}`)
            i = text.indexOf("CASE WHEN fm.role = 'CHILD'", i + 1)
          }
        }
      }
    }
    for (const d of ["app", "lib"]) walk(d)
    const bad = copies.filter((c) => !c.endsWith(`::${MEMBER_NAME_SQL}`) && !c.startsWith(path.join("lib", "member-names.ts") + "::CASE WHEN fm.role = 'CHILD' THEN COALESCE(NULLIF(TRIM(cp.display_name), ''), NULLIF(TRIM(fm.nickname), ''), NULLIF(TRIM(u.first_name), '')) ELSE"))
    assert.deepStrictEqual(bad, [], "every SQL copy of the rule matches MEMBER_NAME_SQL exactly")
    assert.ok(copies.length >= 5, `found ${copies.length} copies`)
    assert.ok(!/last_name/.test(MEMBER_NAME_SQL), "the SQL rule never adds a last name")
    ok(`all ${copies.length} SQL copies match MEMBER_NAME_SQL; none adds a last name`)

    const old = /COALESCE\([^)]*(fm\.nickname|cp\.display_name)[^)]*(first_name|nickname)/
    const leftovers: string[] = []
    for (const f of ["app/api/location/emergency-alert/route.ts", "app/api/cron/location-stale/route.ts", "lib/family-alerts.ts"]) {
      const t = fs.readFileSync(f, "utf8").replace(/CASE WHEN fm\.role = 'CHILD'[\s\S]*?END/g, "")
      if (old.test(t)) leftovers.push(f)
    }
    assert.deepStrictEqual(leftovers, [])
    ok("no old hand-written name orders left in the alert queries")
  }

  // Routes on a fake database.
  const { __setSqlForTests } = await import("../lib/db")
  const { generateAccessToken } = await import("../lib/auth")
  const { NextRequest } = await import("next/server")
  const myName = await import("../app/api/families/[familyId]/my-name/route")
  const profile = await import("../app/api/auth/profile/route")

  const users: Record<string, Row> = {
    "u-mia": { id: "u-mia", email: "mia@example.invalid", first_name: "Mia", last_name: "Lee", is_active: true },
    "u-kit": { id: "u-kit", email: "kit@example.invalid", first_name: "Kit", last_name: "Lee", is_active: true },
  }
  let members: Row[] = []
  const log: { q: string; v: unknown[] }[] = []
  const fresh = () => {
    log.length = 0
    members = [
      { id: "m-mia", family_id: "fam-1", user_id: "u-mia", role: "PARENT", nickname: "Mia", is_active: true },
      { id: "m-mia2", family_id: "fam-2", user_id: "u-mia", role: "GUARDIAN", nickname: "Auntie M", is_active: true },
      { id: "m-kit", family_id: "fam-1", user_id: "u-kit", role: "CHILD", nickname: "Kit", is_active: true },
    ]
    users["u-mia"].first_name = "Mia"
    users["u-mia"].last_name = "Lee"
  }
  fresh()
  const fake = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    log.push({ q, v })
    if (q.includes("FROM users") && q.includes("WHERE id =") && q.startsWith("SELECT")) {
      const u = users[v[0] as string]
      return u ? [u] : []
    }
    if (q.startsWith("SELECT id, role, nickname FROM family_members")) {
      return members.filter((m) => m.family_id === v[0] && m.user_id === v[1] && m.is_active)
    }
    if (q.startsWith("SELECT 1 FROM family_members WHERE user_id =")) {
      return members.filter((m) => m.user_id === v[0] && m.role === "CHILD")
    }
    if (q.startsWith("UPDATE family_members SET nickname =")) {
      const m = members.find((x) => x.id === v[1])
      if (m) m.nickname = v[0]
      return m && q.includes("RETURNING user_id") ? [{ user_id: m.user_id }] : []
    }
    if (q.startsWith("UPDATE users")) {
      // profile PATCH: first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name)
      const u = users[v[v.length - 1] as string]
      if (u) { if (v[0] != null) u.first_name = v[0]; if (v[1] != null) u.last_name = v[1] }
      return []
    }
    if (q.startsWith("UPDATE family_members fm SET nickname = u.first_name")) {
      const [userId, oldFirst, oldFull] = v as string[]
      for (const m of members) {
        if (m.user_id === userId && m.role !== "CHILD" && [oldFirst, oldFull].includes(String(m.nickname ?? "").trim().toLowerCase())) {
          m.nickname = users[userId].first_name
        }
      }
      return []
    }
    return []
  }) as unknown as Parameters<typeof __setSqlForTests>[0]
  __setSqlForTests(fake)

  const quiet = async <T,>(fn: () => Promise<T>) => { const e = console.error; console.error = () => {}; try { return await fn() } finally { console.error = e } }
  const req = async (as: string, method: string, url: string, body: unknown) =>
    new NextRequest(`http://localhost${url}`, {
      method, headers: { "content-type": "application/json", authorization: `Bearer ${await generateAccessToken(as)}` }, body: JSON.stringify(body),
    })
  const setMyName = async (as: string, family: string, nickname: unknown) =>
    quiet(async () => myName.PATCH(await req(as, "PATCH", `/api/families/${family}/my-name`, { nickname }), { params: Promise.resolve({ familyId: family }) }))
  const nick = (id: string) => members.find((m) => m.id === id)!.nickname

  console.log("Name shown to this family")
  {
    assert.strictEqual((await setMyName("u-mia", "fam-1", "  Mom  ")).status, 200)
    assert.strictEqual(nick("m-mia"), "Mom")
    assert.strictEqual(nick("m-mia2"), "Auntie M", "other families untouched")
    ok("an adult sets their own name in one family only (trimmed)")

    assert.strictEqual((await setMyName("u-mia", "fam-1", "")).status, 200)
    assert.strictEqual(nick("m-mia"), null)
    ok("blank goes back to the account name")

    assert.strictEqual((await setMyName("u-kit", "fam-1", "KitKat")).status, 403)
    assert.strictEqual(nick("m-kit"), "Kit")
    assert.strictEqual((await setMyName("u-mia", "fam-other", "X")).status, 403)
    assert.strictEqual((await setMyName("u-mia", "fam-1", "x".repeat(51))).status, 400)
    ok("a child can't rename themselves; non-members and over-long names are refused")
  }

  console.log("changing your account name")
  {
    fresh()
    const r = await quiet(async () => profile.PATCH(await req("u-mia", "PATCH", "/api/auth/profile", { firstName: "Maria" })))
    assert.strictEqual(r.status, 200)
    assert.strictEqual(nick("m-mia"), "Maria", "nickname that was the old first name follows")
    assert.strictEqual(nick("m-mia2"), "Auntie M", "a nickname they chose stays")
    ok("a nickname equal to the old name follows the new one; a chosen nickname stays")

    fresh()
    members[0].nickname = "Mia Lee"
    await quiet(async () => profile.PATCH(await req("u-mia", "PATCH", "/api/auth/profile", { firstName: "Maria" })))
    assert.strictEqual(nick("m-mia"), "Maria")
    ok("also when the nickname was the old full name")

    fresh()
    const k = await quiet(async () => profile.PATCH(await req("u-kit", "PATCH", "/api/auth/profile", { firstName: "Kat" })))
    assert.strictEqual(k.status, 403)
    assert.strictEqual(users["u-kit"].first_name, "Kit")
    ok("a child login can't change its own name")
  }

  console.log("children's names")
  {
    log.length = 0
    await names.setChildName("m-kit", "  Kitty ")
    const writes = log.filter((x) => x.q.startsWith("UPDATE"))
    assert.deepStrictEqual(writes.map((x) => x.q.split(" SET ")[0]), ["UPDATE child_profiles", "UPDATE family_members", "UPDATE users"])
    assert.ok(writes.every((x) => x.v[0] === "Kitty"))
    assert.ok(!writes.some((x) => /last_name/.test(x.q)), "the child's last name is left alone")
    ok("renaming a child updates profile, nickname and login first name; never clears the last name")
  }

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
