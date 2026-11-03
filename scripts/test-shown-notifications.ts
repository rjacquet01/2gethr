// Usage: npx tsx --tsconfig tsconfig.json scripts/test-shown-notifications.ts
// Phone notifications are closed once read in the app (lib/shown-notifications.ts),
// so the Android app icon badge doesn't stay stale. Pure logic plus a fake
// service worker registration; no database, no network.
import assert from "node:assert"
import { shownToClose, syncShownNotifications } from "../lib/shown-notifications"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Fake = { data?: { notificationId?: unknown } | null; closed: boolean; close(): void }
const fake = (notificationId?: unknown): Fake => ({ data: notificationId === undefined ? {} : { notificationId }, closed: false, close() { this.closed = true } })

async function main() {
  const a = fake("n1"), b = fake("n2"), c = fake(), d = fake(42)
  assert.deepEqual(shownToClose([a, b, c, d]), [a, b, c, d], "no ids: all")
  assert.deepEqual(shownToClose([a, b, c, d], ["n2"]), [b], "only the matching in-app id")
  assert.deepEqual(shownToClose([a, b, c, d], []), [], "empty list: none")
  assert.deepEqual(shownToClose([{ ...fake(), data: null }], ["n1"]), [])
  ok("which shown notifications to close")

  let shown: Fake[] = []
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker: { getRegistration: async () => ({ getNotifications: async () => shown }) } },
    configurable: true,
  })

  shown = [fake("n1"), fake("n2"), fake()]
  await syncShownNotifications([{ id: "n1", isRead: true }, { id: "n2", isRead: false }], 1)
  assert.deepEqual(shown.map((n) => n.closed), [true, false, false], "read one closed; unread and unknown stay")
  ok("some unread: close only the read ones")

  shown = [fake("n1"), fake("n2"), fake()]
  await syncShownNotifications([{ id: "n1", isRead: true }], 0)
  assert.ok(shown.every((n) => n.closed), "nothing unread: tray cleared")
  ok("nothing unread: close every shown notification (clears the badge)")

  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: { getRegistration: async () => { throw new Error("no sw") } } }, configurable: true })
  await syncShownNotifications([], 0)
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true })
  await syncShownNotifications([], 0)
  ok("no service worker: quietly does nothing")

  console.log(`\n${passed} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
