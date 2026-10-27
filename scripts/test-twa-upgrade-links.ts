// Usage: npx tsx --tsconfig tsconfig.json scripts/test-twa-upgrade-links.ts
// Inside the Android app (Google Play rules) no upgrade, "see plans" or
// pricing link may be rendered. Two checks, no database and no network:
// 1. UpgradeGate renders neutral text and no link when the app flag is on.
// 2. Every link to /subscription, /subscription/upgrade or /pricing in the
//    signed-in app (app/(dashboard), components) sits behind a gate:
//    <UpgradeGate>, a canPurchase / showUpgrade condition, or one of the few
//    allowed links below. A new ungated upgrade link fails this test.
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

const ROOT = path.join(__dirname, "..")

// Links that may stay in the app, with why.
const ALLOWED: Array<{ file: string; snippet: string; why: string }> = [
  { file: "app/(dashboard)/layout.tsx", snippet: "href: '/subscription', icon: Crown", why: "menu item, labelled \"My plan\" in the app; the page has no prices there" },
  { file: "app/(dashboard)/layout.tsx", snippet: "<Link href=\"/subscription\">\n                    <Crown", why: "account menu item, labelled \"My plan\" in the app" },
  { file: "app/(dashboard)/subscription/upgrade/page.tsx", snippet: "", why: "upgrade page: sends the app back to /subscription before rendering" },
  { file: "app/(dashboard)/subscription/confirmation/page.tsx", snippet: "", why: "after a website checkout; not reachable in the app" },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(e.name)) out.push(p)
  }
  return out
}

async function main() {
  const { UpgradeGateView } = await import("../components/upgrade-gate")
  const { IN_APP_UPGRADE_COPY } = await import("../lib/plan-limits")
  const link = React.createElement("a", { href: "/subscription" }, "Upgrade")
  type GateProps = { ready: boolean; canPurchase: boolean; inApp?: React.ReactNode }
  const gate = (props: GateProps) =>
    renderToStaticMarkup(React.createElement(UpgradeGateView as unknown as React.FC<GateProps>, props, link))

  // 1. The gate in each state.
  const app = gate({ ready: true, canPurchase: false })
  assert.ok(!/<a\b/.test(app), `app: no link (${app})`)
  assert.ok(!/upgrade|\/subscription|\/pricing|\$\d/i.test(app.replace(IN_APP_UPGRADE_COPY, "")), app)
  assert.ok(app.includes("Manage your plan at mytogethr.com"))
  const custom = gate({ ready: true, canPurchase: false, inApp: React.createElement("span", null, "Alerts paused") })
  assert.strictEqual(custom, "<span>Alerts paused</span>")
  const unknown = gate({ ready: false, canPurchase: false })
  assert.strictEqual(unknown, "", "nothing before the check has run, so no flash of a link")
  const web = gate({ ready: true, canPurchase: true })
  assert.strictEqual(web, '<a href="/subscription">Upgrade</a>', "the website keeps its link")
  assert.ok(!/https?:|href|\/subscription|\/pricing/.test(IN_APP_UPGRADE_COPY), "the in-app copy has no link")
  ok("UpgradeGate: neutral text and no link in the app, the link on the website, nothing before the check")

  // 2. Every upgrade/pricing link in the signed-in app is gated.
  const files = [...walk(path.join(ROOT, "app", "(dashboard)")), ...walk(path.join(ROOT, "components"))]
  const LINK = /(href=\{?["'`]\/(subscription|pricing)|push\(\s*["'`]\/(subscription|pricing)|href:\s*["']\/(subscription|pricing))/g
  const ungated: string[] = []
  let checked = 0
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/")
    const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    for (const m of src.matchAll(LINK)) {
      checked++
      const at = m.index ?? 0
      const before = src.slice(0, at)
      const open = before.lastIndexOf("<UpgradeGate")
      const close = before.lastIndexOf("</UpgradeGate>")
      const inGate = open > close
      const window = src.slice(Math.max(0, at - 1500), at)
      const conditional = /canPurchase|showUpgrade/.test(window)
      const allowed = ALLOWED.some((a) => a.file === rel && (a.snippet === "" || src.slice(at - 40, at + 120).includes(a.snippet) || src.slice(Math.max(0, at - 200), at + 200).includes(a.snippet)))
      if (!inGate && !conditional && !allowed) {
        const line = before.split("\n").length
        ungated.push(`${rel}:${line}  ${src.split("\n")[line - 1].trim()}`)
      }
    }
  }
  assert.ok(checked > 5, `found the links to check (${checked})`)
  assert.deepStrictEqual(ungated, [], `ungated upgrade/pricing links:\n${ungated.join("\n")}`)
  ok(`every upgrade/pricing link in the signed-in app is gated (${checked} links checked)`)

  console.log(`\n${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
