// Usage: npx tsx --tsconfig tsconfig.json scripts/test-signup-source.ts
// Sign-up source labels (lib/signup-source.ts): ?ref= / utm tags, referring
// sites, Instagram/TikTok in-app browsers, the Android app; and the server's
// re-check of what a browser sends. Pure logic, no database.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }
const own = "mytogethr.com"

async function main() {
const { detectSignupSource, cleanSignupSource, sourceSlug } = await import("../lib/signup-source")

assert.deepEqual(detectSignupSource({ search: "?ref=tiktok", ownHost: own }), { source: "tiktok" })
assert.deepEqual(detectSignupSource({ search: "?ref=TikTok Bio!", ownHost: own }), { source: "tiktok-bio" })
assert.deepEqual(detectSignupSource({ search: "?utm_source=instagram&utm_campaign=Fall Launch", ownHost: own }), { source: "instagram", campaign: "fall-launch" })
assert.deepEqual(detectSignupSource({ search: "?ref=youtube", referrer: "https://www.google.com/", ownHost: own }), { source: "youtube" }, "a tag beats the referrer")
ok("?ref= and utm tags, cleaned to short labels")

assert.deepEqual(detectSignupSource({ search: "", referrer: "https://www.youtube.com/", ownHost: own }), { source: "youtube" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "https://m.youtube.com/watch?v=abc", ownHost: own }), { source: "youtube" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "https://l.instagram.com/?u=https%3A%2F%2Fmytogethr.com", ownHost: own }), { source: "instagram" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "https://t.co/xyz", ownHost: own }), { source: "x" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "https://www.google.co.uk/", ownHost: own }), { source: "google" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "https://someblog.example.org/post/1?x=y", ownHost: own }), { source: "someblog-example-org" }, "other sites: host only")
ok("referring sites, host only")

const INSTAGRAM_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.12.235"
const TIKTOK_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.5.0"
assert.deepEqual(detectSignupSource({ search: "", referrer: "", ownHost: own, ua: INSTAGRAM_UA }), { source: "instagram" })
assert.deepEqual(detectSignupSource({ search: "", ownHost: own, ua: TIKTOK_UA }), { source: "tiktok" })
ok("in-app browsers with no referrer")

assert.deepEqual(detectSignupSource({ search: "?source=android-app", ownHost: own }), { source: "android-app" })
assert.deepEqual(detectSignupSource({ search: "", referrer: "android-app://com.togethrapp.mobile/", ownHost: own }), { source: "android-app" })
assert.equal(detectSignupSource({ search: "", referrer: "https://mytogethr.com/pricing", ownHost: own }), null, "own site: no clue")
assert.equal(detectSignupSource({ search: "", referrer: "https://www.mytogethr.com/", ownHost: own }), null)
assert.equal(detectSignupSource({ search: "", referrer: "", ownHost: own }), null, "typed in: no clue (sign-up says direct)")
ok("Android app, own site, typed-in")

assert.deepEqual(cleanSignupSource({ source: "TikTok", campaign: "Launch Week" }), { source: "tiktok", campaign: "launch-week" })
assert.equal(cleanSignupSource({ source: "<script>" })?.source, "script")
assert.equal(cleanSignupSource({ source: "!!!" }), null)
assert.equal(cleanSignupSource("tiktok"), null)
assert.equal(cleanSignupSource(null), null)
assert.equal(sourceSlug("x".repeat(100))?.length, 40)
ok("server re-check: short slugs only")

console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
