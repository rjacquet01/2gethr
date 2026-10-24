// Usage: npm run demo:frame   (after npm run demo:capture)
//
// Store-ready versions of the raw captures: navy background, the white
// logotype, a headline and one line under it, and the screen in a plain
// device frame (no other brand's hardware). Reads PLAY_RAW_DIR/<profile>/*.png
// and writes PLAY_RAW_DIR/framed/<profile>/*.png at Play's sizes.
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { chromium } from "@playwright/test"

const OUT = process.env.PLAY_RAW_DIR || path.join(os.homedir(), "Downloads", "play-raw")
const LOGO = path.join(process.cwd(), "public", "brand", "logotype-white.svg")

// Output size per profile: phone 9:16 at 1080x1920; tablets at the raw size.
const CANVAS: Record<string, { width: number; height: number }> = {
  phone: { width: 1080, height: 1920 },
  tablet7: { width: 1200, height: 1920 },
  tablet10: { width: 1600, height: 2560 },
}

// Listing order from the Play checklist. No "text alerts" until texts are approved.
const CAPTIONS: Record<string, [string, string]> = {
  "01-home": ["Your family, one place", "Today's plans, tasks and who's where, at a glance"],
  "02-calendar-month": ["One shared calendar", "Everyone's events in their own color"],
  "03-tasks": ["Chores that get done", "Assign tasks and check them off together"],
  "04-live-location": ["See where everyone is", "Live location, shared only with your family"],
  "05-places-alerts": ["Know they arrived safely", "Alerts when someone gets to school, work or home"],
  "06-reminders": ["Reminders for everyone", "Set them for yourself or anyone in the family"],
  "07-board": ["The family board", "Notes and flyers everyone sees"],
  "08-family": ["Built for the whole family", "Parents, kids and grandparents, with the right controls"],
}

function page(shot: string, canvas: { width: number; height: number }, title: string, sub: string, shotW: number, shotH: number): string {
  const { width: W, height: H } = canvas
  const bezel = Math.round(W * 0.016)
  // Text on top at its natural height (one or two lines); the device fills
  // the rest, centered and never cropped.
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;800&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    font-family: Inter, system-ui, sans-serif; color: #fff; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center;
    padding: ${Math.round(H * 0.035)}px ${Math.round(W * 0.06)}px ${Math.round(H * 0.035)}px;
    background: radial-gradient(120% 70% at 50% 0%, #4a5577 0%, #3b4563 45%, #2b3249 100%);
  }
  .logo { height: ${Math.round(H * 0.026)}px; }
  h1 { margin: ${Math.round(H * 0.022)}px 0 0; text-align: center; font-weight: 800;
       font-size: ${Math.round(W * 0.064)}px; line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; }
  p { margin: ${Math.round(H * 0.012)}px 0 0; text-align: center; font-weight: 500;
      font-size: ${Math.round(W * 0.033)}px; line-height: 1.3; color: #ffd9c2; text-wrap: balance; }
  .dot { color: #ff8844; }
  .stage { flex: 1; min-height: 0; width: 100%; display: flex; justify-content: center; margin-top: ${Math.round(H * 0.03)}px; }
  .device { height: 100%; aspect-ratio: ${shotW} / ${shotH}; box-sizing: content-box; padding: ${bezel}px;
            border-radius: ${Math.round(W * 0.06)}px; background: #12162a;
            box-shadow: 0 ${Math.round(H * 0.012)}px ${Math.round(H * 0.04)}px rgba(0,0,0,.45), inset 0 0 0 2px #2a3150; }
  .stage { padding-bottom: ${bezel * 2}px; box-sizing: border-box; }
  .device img { display: block; width: 100%; height: 100%; border-radius: ${Math.round(W * 0.06) - bezel}px; }
</style></head><body>
  <img class="logo" src="${pathToFileURL(LOGO).href}" alt="">
  <h1>${title}<span class="dot">.</span></h1>
  <p>${sub}</p>
  <div class="stage"><div class="device"><img src="${pathToFileURL(shot).href}" alt=""></div></div>
</body></html>`
}

function pngSize(file: string): { width: number; height: number } {
  const b = fs.readFileSync(file)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

async function main() {
  const browser = await chromium.launch()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "togethr-frame-"))
  let made = 0
  try {
    for (const [profile, canvas] of Object.entries(CANVAS)) {
      const src = path.join(OUT, profile)
      if (!fs.existsSync(src)) continue
      const dest = path.join(OUT, "framed", profile)
      fs.mkdirSync(dest, { recursive: true })
      const pageCtx = await browser.newPage({ viewport: canvas, deviceScaleFactor: 1 })
      for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".png")).sort()) {
        const key = file.replace(/\.png$/, "")
        const caption = CAPTIONS[key]
        if (!caption) continue
        const shot = path.join(src, file)
        const { width, height } = pngSize(shot)
        const html = path.join(tmp, `${profile}-${key}.html`)
        fs.writeFileSync(html, page(shot, canvas, caption[0], caption[1], width, height))
        await pageCtx.goto(pathToFileURL(html).href, { waitUntil: "networkidle" })
        await pageCtx.evaluate(() => document.fonts.ready)
        await pageCtx.screenshot({ path: path.join(dest, file), type: "png" })
        made++
        console.log(`  framed/${profile}/${file}`)
      }
      await pageCtx.close()
    }
  } finally {
    await browser.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (!made) throw new Error(`No raw captures in ${OUT}: run npm run demo:capture first.`)
  console.log(`\n${made} framed screenshots in ${path.join(OUT, "framed")}`)
}

main().catch((e) => {
  console.error("Framing failed:", e instanceof Error ? e.message : e)
  process.exit(1)
})
