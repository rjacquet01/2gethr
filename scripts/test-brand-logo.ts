// Usage: npx tsx --tsconfig tsconfig.json scripts/test-brand-logo.ts
// The Togethr logotype (components/brand/logo.tsx): the right asset for each
// variant and tone, alt text, fixed size (no layout shift), theme switching;
// the brand files in public/; and the email header (lib/services/email.ts).
// Pure rendering and file checks: no database, no network.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

async function main() {
  const React = await import("react")
  const { renderToStaticMarkup } = await import("react-dom/server")
  const { Logo, brandLogoSrc, brandLogoWidth, BRAND_MOTTO } = await import("../components/brand/logo")
  const { brandEmailHtml, EMAIL_TEMPLATES, EMAIL_LOGO_URL } = await import("../lib/services/email")
  const sharp = (await import("sharp")).default

  const pub = (p: string) => path.join(process.cwd(), "public", p)
  const html = (props: Parameters<typeof Logo>[0]) => renderToStaticMarkup(React.createElement(Logo, props))
  const imgs = (h: string) => [...h.matchAll(/<img [^>]*>/g)].map((m) => m[0])
  const attr = (img: string, name: string) => img.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

  // --- assets ---
  for (const variant of ["logotype", "mark"] as const) {
    for (const tone of ["color", "reversed"] as const) {
      const src = brandLogoSrc(variant, tone)
      assert.equal(src, `/brand/${variant}-${tone}.svg`)
      const svg = fs.readFileSync(pub(src), "utf8")
      assert.match(svg, /^<svg /)
      assert.ok(!/<script|on\w+=|href=/i.test(svg), `${src} has no scripts or links`)
    }
  }
  assert.ok(fs.existsSync(pub("brand/logotype-white.svg")))
  ok("every variant/tone maps to its SVG in public/brand (plain vector, no scripts)")

  // --- component ---
  let h = html({ variant: "logotype", tone: "color" })
  let list = imgs(h)
  assert.equal(list.length, 1)
  assert.equal(attr(list[0], "src"), "/brand/logotype-color.svg")
  assert.equal(attr(list[0], "alt"), "Togethr")
  assert.equal(attr(list[0], "height"), "28")
  assert.equal(attr(list[0], "width"), String(brandLogoWidth("logotype", 28)))
  assert.equal(brandLogoWidth("logotype", 28), 92)
  ok("logotype/color: one image, alt Togethr, explicit width and height (92 x 28)")

  h = html({ variant: "logotype", tone: "reversed", height: 30 })
  list = imgs(h)
  assert.equal(list.length, 1)
  assert.equal(attr(list[0], "src"), "/brand/logotype-reversed.svg")
  ok("logotype/reversed (dark sidebar)")

  h = html({ variant: "mark", tone: "color", height: 30 })
  list = imgs(h)
  assert.equal(attr(list[0], "src"), "/brand/mark-color.svg")
  assert.equal(attr(list[0], "width"), String(brandLogoWidth("mark", 30)))
  assert.ok(brandLogoWidth("mark", 30) < 90, "the mark is the narrow option")
  ok("mark: the T alone, under 90px wide")

  h = html({ variant: "logotype" })
  list = imgs(h)
  assert.equal(list.length, 2, "auto tone renders both")
  assert.equal(attr(list[0], "src"), "/brand/logotype-color.svg")
  assert.match(attr(list[0], "class") || "", /\bdark:hidden\b/)
  assert.equal(attr(list[1], "src"), "/brand/logotype-reversed.svg")
  assert.match(attr(list[1], "class") || "", /\bhidden\b.*\bdark:block\b/)
  ok("auto tone: color in light mode, reversed in dark mode (CSS only, no flash)")

  assert.equal(BRAND_MOTTO, "Connect people, connect events.")
  ok("the motto")

  // --- share image and email logo ---
  const og = await sharp(pub("og-image.png")).metadata()
  assert.equal(`${og.width}x${og.height}`, "1200x630")
  const em = await sharp(pub("brand/logotype-color-email.png")).metadata()
  assert.equal(em.width, 480)
  assert.equal(em.hasAlpha, true, "transparent")
  ok("og-image.png is 1200x630; the email logo PNG is 480px wide, transparent")

  // --- emails ---
  assert.equal(EMAIL_LOGO_URL, "https://mytogethr.com/brand/logotype-color-email.png")
  const welcome = EMAIL_TEMPLATES.WELCOME("Sam").html
  assert.ok(welcome.includes(EMAIL_LOGO_URL))
  assert.ok(!/#0d9488/i.test(welcome), "old teal gone")
  assert.ok(!/font-weight: bold;">[A-Z]<\/span>/.test(welcome), "old letter tile gone")
  assert.equal(brandEmailHtml(welcome), welcome, "full templates are sent as they are")
  const wrapped = brandEmailHtml("<p>Reminder: Soccer at 5</p>")
  assert.ok(wrapped.startsWith("<!DOCTYPE html>"))
  assert.ok(wrapped.includes(EMAIL_LOGO_URL) && wrapped.includes('alt="Togethr"'))
  assert.ok(wrapped.includes("<p>Reminder: Soccer at 5</p>"))
  assert.ok(wrapped.includes("Connect people, connect events."))
  ok("emails: templates carry the hosted logotype; short bodies get the branded card")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
