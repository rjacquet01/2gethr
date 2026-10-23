// Usage: npx tsx --tsconfig tsconfig.json scripts/test-quick-add.ts
// Quick Add on Tasks and Reminders: the weekday parser (whole weekday names
// only, so "friend" or "sunscreen" stay in the title) and the suggestion
// filtering in lib/quick-add-suggestions.ts. Pure functions: no database, no network.
import assert from "node:assert"
import { parseQuickAdd, type Person } from "../components/tasks-extras"
import { parseReminderQuick } from "../components/reminders-extras"
import {
  QUICK_ADD_SUGGESTIONS,
  SUGGESTION_CATEGORY_LABELS,
  filterSuggestions,
  suggestedTokens,
  suggestionCategories,
} from "../lib/quick-add-suggestions"

let passed = 0
const ok = (name: string, fn: () => void) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const people: Person[] = [{ key: "u1", name: "Bob Smith", userId: "1" }]

ok("Return book to friend: whole title, no due date", () => {
  const p = parseQuickAdd("Return book to friend", people)
  assert.equal(p.title, "Return book to friend")
  assert.equal(p.due, undefined)
})
ok("Check sunscreen expiry: title kept", () => {
  const p = parseQuickAdd("Check sunscreen expiry", people)
  assert.equal(p.title, "Check sunscreen expiry")
  assert.equal(p.due, undefined)
})
ok("Pay monthly bill fri: strips only fri, due Friday", () => {
  const p = parseQuickAdd("Pay monthly bill fri", people)
  assert.equal(p.title, "Pay monthly bill")
  assert.equal(p.due?.getDay(), 5)
})
ok("Clean sunglasses tomorrow @Bob !high", () => {
  const p = parseQuickAdd("Clean sunglasses tomorrow @Bob !high", people)
  assert.equal(p.title, "Clean sunglasses")
  assert.equal(p.person?.key, "u1")
  assert.equal(p.priority, "high")
  const t = new Date()
  t.setDate(t.getDate() + 1)
  assert.equal(p.due?.toDateString(), t.toDateString())
})
ok("words that start like weekdays stay put", () => {
  for (const w of ["monitor", "saturate", "wedding", "thumb", "sundae", "tuesdays", "friendly"]) {
    const p = parseQuickAdd(`Fix the ${w}`, people)
    assert.equal(p.title, `Fix the ${w}`, w)
    assert.equal(p.due, undefined, w)
  }
})
ok("weekday names and abbreviations still work", () => {
  const want: Record<string, number> = { sun: 0, monday: 1, tues: 2, wed: 3, thurs: 4, thu: 4, friday: 5, sat: 6, "next saturday": 6 }
  for (const [w, day] of Object.entries(want)) {
    const p = parseQuickAdd(`Mow ${w}`, people)
    assert.equal(p.title, "Mow", w)
    assert.equal(p.due?.getDay(), day, w)
  }
})
ok("a picked suggestion keeps its title word for word", () => {
  const title = "Pack your school bag for tomorrow"
  const p = parseQuickAdd(title, people, title)
  assert.equal(p.title, title)
  assert.equal(p.due, undefined)
  const q = parseQuickAdd(`${title} @Bob today !medium`, people, title)
  assert.equal(q.title, title)
  assert.equal(q.person?.key, "u1")
  assert.equal(q.priority, "medium")
  assert.equal(q.due?.toDateString(), new Date().toDateString())
  // Edited away from the suggestion: parsed normally.
  assert.equal(parseQuickAdd("Pack bag tomorrow", people, title).title, "Pack bag")
})

const now = new Date(2026, 9, 22, 9) // a Thursday
ok("reminders: friend / monthly bill / sunscreen", () => {
  const a = parseReminderQuick("Call friend", [], now)
  assert.equal(a.title, "Call friend")
  assert.equal(a.at, null)
  const b = parseReminderQuick("Check sunscreen expiry", [], now)
  assert.equal(b.title, "Check sunscreen expiry")
  const c = parseReminderQuick("Pay bill fri 9am", [], now)
  assert.equal(c.title, "Pay bill")
  assert.equal(c.at?.getDay(), 5)
})
ok("reminders: spoken times (p.m. with dots, at 5:30)", () => {
  const at = (s: string) => {
    const p = parseReminderQuick(s, [], now)
    return `${p.title} | ${p.at?.getDate()} ${p.at?.getHours()}:${String(p.at?.getMinutes()).padStart(2, "0")}`
  }
  assert.equal(at("Pay car insurance at 5:30 p.m. today"), "Pay car insurance | 22 17:30")
  assert.equal(at("Pay car insurance at 5:30 p.m. today."), "Pay car insurance | 22 17:30")
  assert.equal(at("Call mom tomorrow at 8 a.m."), "Call mom | 23 8:00")
  assert.equal(at("Dentist 3 p. m. friday"), "Dentist | 23 15:00")
  assert.equal(at("Soccer 6:15 PM"), "Soccer | 22 18:15")
  assert.equal(at("Walk dog at 5:30"), "Walk dog | 22 17:30")
  assert.equal(at("Gym at 9:30"), "Gym | 22 9:30")
  assert.equal(at("Leave 17:45"), "Leave | 22 17:45")
})

ok("Kids' Chores only when the family has children", () => {
  assert.ok(!suggestionCategories(false).includes("kids"))
  assert.ok(suggestionCategories(true).includes("kids"))
  assert.equal(filterSuggestions({ category: "kids", hasChildren: false }).length, 0)
  assert.equal(filterSuggestions({ category: "kids", hasChildren: true }).length, 10)
  assert.ok(!filterSuggestions({ category: "home", query: "bed", hasChildren: false }).some((s) => s.kid))
  assert.ok(filterSuggestions({ category: "home", query: "make your bed", hasChildren: true }).some((s) => s.kid))
})
ok("10 suggestions in each category, Work & Admin named as asked", () => {
  for (const c of ["home", "errands", "admin", "health", "kids"] as const) {
    assert.equal(QUICK_ADD_SUGGESTIONS.filter((s) => s.category === c).length, 10, c)
  }
  assert.equal(SUGGESTION_CATEGORY_LABELS.admin, "Work & Admin")
  assert.equal(new Set(QUICK_ADD_SUGGESTIONS.map((s) => s.title)).size, QUICK_ADD_SUGGESTIONS.length, "no duplicate titles")
  const home = QUICK_ADD_SUGGESTIONS.filter((s) => s.category === "home").map((s) => s.title)
  assert.equal(home[0], "Clean the hair out of the shower drain")
  assert.equal(home[9], "Run a cleaning cycle on the washing machine")
  const health = QUICK_ADD_SUGGESTIONS.filter((s) => s.category === "health").map((s) => s.title)
  assert.equal(health[9], "Stand up and do ten air squats to wake up")
})
ok("a category lists its suggestions", () => {
  const home = filterSuggestions({ category: "home", hasChildren: false })
  assert.equal(home.length, 10)
  assert.ok(home.every((s) => s.category === "home"))
})
ok("typing: up to 5 case-insensitive matches across categories", () => {
  const r = filterSuggestions({ category: "home", query: "BUY", hasChildren: false })
  assert.ok(r.length > 0 && r.length <= 5)
  assert.ok(r.every((s) => s.title.toLowerCase().includes("buy")))
  assert.ok(r.some((s) => s.category === "errands"))
  assert.equal(filterSuggestions({ category: "home", query: "the", hasChildren: true }).length, 5)
})
ok("open tasks aren't suggested again", () => {
  const r = filterSuggestions({ category: "home", hasChildren: false, openTitles: ["  wipe down the MICROWAVE food SPLATTERS "] })
  assert.ok(!r.some((s) => s.title === "Wipe down the microwave food splatters"))
  assert.equal(r.length, 9)
})
ok("suggested timing: today / tomorrow / the coming Saturday + priority", () => {
  const s = (title: string) => QUICK_ADD_SUGGESTIONS.find((x) => x.title === title)!
  assert.equal(suggestedTokens(s("Feed the pet"), now), "today !high")
  assert.equal(suggestedTokens(s("Wash the kitchen trash can liner"), now), "saturday !low")
  assert.equal(suggestedTokens(s("Water the plants"), now), "saturday !low")
  assert.equal(suggestedTokens(s("Wash the kitchen trash can liner"), new Date(2026, 9, 24)), "today !low")
  assert.equal(suggestedTokens({ title: "x", category: "home", due: "tomorrow" }, now), "tomorrow")
})
ok("every suggestion title survives the parser", () => {
  for (const s of QUICK_ADD_SUGGESTIONS) {
    const p = parseQuickAdd(s.title, people, s.title)
    assert.equal(p.title, s.title)
  }
})

console.log(`${passed} passed`)
