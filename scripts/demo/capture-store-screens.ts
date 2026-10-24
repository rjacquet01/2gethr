// Usage: npm run demo:capture   (after npm run demo:seed, with the app running)
//
// Raw Play Store screens of the demo family: phone, 7-inch and 10-inch tablet
// PNGs plus a ~25 second phone walkthrough video. Signs in as the demo owner
// from .env.demo.local (never printed).
//   DEMO_BASE_URL  app to capture (default http://localhost:3124, a local `next start`)
//   PLAY_RAW_DIR   output folder (default ~/Downloads/play-raw)
//   DEMO_ONLY      comma list of profiles to run (phone,tablet7,tablet10,video)
import { spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test"

const BASE = process.env.DEMO_BASE_URL || "http://localhost:3124"
const OUT = process.env.PLAY_RAW_DIR || path.join(os.homedir(), "Downloads", "play-raw")
const ONLY = (process.env.DEMO_ONLY || "phone,tablet7,tablet10,video").split(",")
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36"

const PROFILES = {
  phone: { width: 390, height: 844, scale: 3 }, // 1170x2532
  tablet7: { width: 600, height: 960, scale: 2 }, // 1200x1920
  tablet10: { width: 800, height: 1280, scale: 2 }, // 1600x2560
} as const

const SCREENS: [string, string][] = [
  ["01-home", "/dashboard"],
  ["02-calendar-month", "/calendar"],
  ["03-tasks", "/tasks"],
  ["04-live-location", "/location"],
  ["05-places-alerts", "/places"],
  ["06-reminders", "/dashboard/reminders"],
  ["07-board", "/board"],
  ["08-family", "/family"],
]

// Nothing that isn't the app: toasts, the Next dev badge, scrollbars, caret.
const CLEAN_CSS = `
  [data-sonner-toaster], nextjs-portal, #__next-build-watcher { display: none !important; }
  ::-webkit-scrollbar { display: none; }
  * { caret-color: transparent !important; scrollbar-width: none; }
`

function demoLogin(): { email: string; password: string } {
  let text = ""
  try {
    text = fs.readFileSync(path.join(process.cwd(), ".env.demo.local"), "utf8")
  } catch {
    throw new Error("No .env.demo.local: run npm run demo:seed first.")
  }
  const get = (k: string) => text.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1].trim()
  const email = get("DEMO_EMAIL")
  const password = get("DEMO_PASSWORD")
  if (!email || !password) throw new Error(".env.demo.local is missing DEMO_EMAIL or DEMO_PASSWORD: run npm run demo:seed.")
  return { email, password }
}

async function newContext(browser: Browser, p: { width: number; height: number; scale: number }, extra: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({
    baseURL: BASE,
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.scale,
    isMobile: true,
    hasTouch: true,
    userAgent: UA,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "America/New_York",
    // No geolocation permission: the page shows the family's shared pins, not this browser's.
    ...extra,
  })
  await ctx.addInitScript((css) => {
    // The app has no service worker on localhost captures; keep any install prompt away.
    window.addEventListener("beforeinstallprompt", (e) => e.preventDefault())
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style")
      s.textContent = css
      document.head.appendChild(s)
    })
  }, CLEAN_CSS)
  return ctx
}

type SignedIn = Awaited<ReturnType<BrowserContext["storageState"]>>

/**
 * Signs in once per run and returns the session for every profile: one login
 * instead of four keeps repeat runs clear of the login rate limit. The access
 * token lasts 15 minutes, longer than a full run.
 */
async function signIn(browser: Browser): Promise<SignedIn> {
  const { email, password } = demoLogin()
  const ctx = await newContext(browser, PROFILES.phone)
  const page = await ctx.newPage()
  await page.goto("/login")
  await page.fill("#email", email)
  await page.fill("#password", password)
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login"), { timeout: 30_000 }),
    page.click("button[type=submit]"),
  ])
  if (!res.ok()) {
    await ctx.close()
    throw new Error(res.status() === 429
      ? "Sign-in is rate limited after many runs: wait a few minutes and try again."
      : `Sign-in failed (${res.status()}): run npm run demo:seed to reset the demo account.`)
  }
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 })
  const state = await ctx.storageState()
  await ctx.close()
  return state
}

/** Network quiet, fonts and images in, map tiles drawn, animations finished. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
  await page.evaluate(async () => {
    await document.fonts.ready
    const imgs = [...document.images].filter((i) => !i.complete)
    await Promise.race([
      Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r }))),
      new Promise((r) => setTimeout(r, 8000)),
    ])
  })
  await page.waitForTimeout(1200)
}

async function captureProfile(browser: Browser, name: keyof typeof PROFILES, state: SignedIn) {
  const dir = path.join(OUT, name)
  fs.mkdirSync(dir, { recursive: true })
  const ctx = await newContext(browser, PROFILES[name], { storageState: state })
  const page = await ctx.newPage()
  const problems: string[] = []
  page.on("pageerror", (e) => problems.push(e.message.slice(0, 200)))
  for (const [file, route] of SCREENS) {
    await page.goto(route)
    await settle(page)
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    if (wide) problems.push(`${file}: wider than the screen`)
    await page.screenshot({ path: path.join(dir, `${file}.png`), type: "png" })
    console.log(`  ${name}/${file}.png`)
  }
  await ctx.close()
  return problems
}

const pause = (page: Page, ms = 800) => page.waitForTimeout(ms)

async function smoothScroll(page: Page, dy: number) {
  await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), dy)
  await pause(page, 900)
}

async function tapNav(page: Page, label: string) {
  await page.locator("nav").getByRole("link", { name: label, exact: true }).last().tap()
  await page.waitForLoadState("networkidle").catch(() => {})
  await pause(page)
}

async function openMenuItem(page: Page, label: string) {
  await page.getByRole("button", { name: /menu/i }).first().tap()
  await pause(page, 600)
  await page.getByRole("link", { name: label, exact: true }).first().tap()
  await page.waitForLoadState("networkidle").catch(() => {})
  await pause(page)
}

/** Playwright's own ffmpeg (installed with its browsers): FFMPEG_PATH overrides. */
function findFfmpeg(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "ms-playwright")
      : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : path.join(os.homedir(), ".cache", "ms-playwright"))
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => d.startsWith("ffmpeg-")).sort().reverse() : []
  for (const d of dirs) {
    for (const exe of ["ffmpeg-win64.exe", "ffmpeg-linux", "ffmpeg-mac"]) {
      const p = path.join(root, d, exe)
      if (fs.existsSync(p)) return p
    }
  }
  throw new Error("No ffmpeg found: run npx playwright install ffmpeg, or set FFMPEG_PATH.")
}

/**
 * Records the page at device pixels. Playwright's recordVideo draws the CSS
 * viewport (405x720) into the corner of a larger frame, so instead take
 * Chrome's screencast frames (1080x1920 at this scale) and encode them at a
 * steady 25 fps with ffmpeg.
 */
async function startScreencast(page: Page, width: number, height: number) {
  const cdp = await page.context().newCDPSession(page)
  const frames: { t: number; jpeg: Buffer }[] = []
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: f.metadata.timestamp ?? Date.now() / 1000, jpeg: Buffer.from(f.data, "base64") })
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {})
  })
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
  return async (dest: string) => {
    const stoppedAt = Date.now() / 1000
    await cdp.send("Page.stopScreencast")
    if (frames.length === 0) throw new Error("No video frames were captured.")
    const fps = 25
    const start = frames[0].t
    const last = frames[frames.length - 1].t
    // Frames arrive only when the screen changes, so a still ending would be
    // cut short: run to when recording stopped (timestamps are epoch seconds).
    const end = Math.abs(stoppedAt - last) < 60 ? Math.max(stoppedAt, last + 0.5) : last + 1
    const ff = spawn(findFfmpeg(), [
      "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "pipe:0",
      // Playwright's ffmpeg has only the VP9 encoder.
      "-an", "-c:v", "libvpx-vp9", "-b:v", "6M", "-crf", "18", "-deadline", "good", "-cpu-used", "4", "-row-mt", "1", "-pix_fmt", "yuv420p",
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white`,
      "-y", dest,
    ], { stdio: ["pipe", "ignore", "pipe"] })
    let err = ""
    ff.stderr.on("data", (d) => { err += d })
    ff.stdin.on("error", () => {}) // ffmpeg quit early: reported by the close handler below
    const done = new Promise<void>((resolve, reject) => ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(0, 300)}`)))))
    // Each output frame shows the latest screencast frame at that moment.
    let i = 0
    for (let t = start; t < end; t += 1 / fps) {
      while (i + 1 < frames.length && frames[i + 1].t <= t) i++
      if (!ff.stdin.write(frames[i].jpeg)) await new Promise((r) => ff.stdin.once("drain", r))
    }
    ff.stdin.end()
    await done
  }
}

// 9:16 phone, 1080x1920 frames.
async function recordWalkthrough(browser: Browser, state: SignedIn) {
  fs.mkdirSync(OUT, { recursive: true })
  const view = { width: 405, height: 720, scale: 1080 / 405 }
  const ctx = await newContext(browser, view, { storageState: state })
  const page = await ctx.newPage()
  await page.goto("/dashboard")
  await settle(page)
  const stop = await startScreencast(page, 1080, 1920)
  await pause(page, 1500)
  await smoothScroll(page, 420)
  await smoothScroll(page, -420)

  await tapNav(page, "Calendar")
  await settle(page)
  // The month grid fills in after the page loads.
  await page.getByText(/\d+ events?/).first().waitFor({ timeout: 10_000 }).catch(() => {})
  await pause(page, 2200)

  await tapNav(page, "Tasks")
  await settle(page)
  await pause(page)
  // Check off the first open task ("Pack soccer bag" or similar).
  const mark = page.getByRole("button", { name: "Mark as done", exact: true }).first()
  if (await mark.count()) {
    await mark.tap()
    await pause(page, 2200)
  }

  await tapNav(page, "Location")
  await settle(page)
  await page.locator(".leaflet-marker-icon").first().waitFor({ timeout: 10_000 }).catch(() => {})
  await pause(page, 2200)
  await smoothScroll(page, 360)

  await openMenuItem(page, "Places")
  await settle(page)
  await page.getByText("Newton, MA").first().waitFor({ timeout: 10_000 }).catch(() => {})
  await pause(page, 1500)

  await openMenuItem(page, "Reminders")
  await settle(page)
  // End on the list, not its loading skeleton.
  await page.getByText(/Refill prescription|Buy birthday gift/).first().waitFor({ timeout: 10_000 }).catch(() => {})
  await pause(page, 3200)

  await stop(path.join(OUT, "walkthrough.webm"))
  await ctx.close()
  console.log(`  walkthrough.webm`)
}

async function main() {
  const browser = await chromium.launch()
  const problems: string[] = []
  try {
    const state = await signIn(browser)
    for (const name of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) {
      if (ONLY.includes(name)) problems.push(...(await captureProfile(browser, name, state)).map((p) => `${name}: ${p}`))
    }
    if (ONLY.includes("video")) await recordWalkthrough(browser, state)
  } finally {
    await browser.close()
  }
  console.log(`\nSaved to ${OUT}`)
  if (problems.length) {
    console.log("Check these:")
    for (const p of problems) console.log("  - " + p)
  }
}

main().catch((e) => {
  console.error("Capture failed:", e instanceof Error ? e.message : e)
  process.exit(1)
})
