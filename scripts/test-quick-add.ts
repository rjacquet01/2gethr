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
// What Google Chrome's recognizer actually typed in a live test (Oct 23),
// plus other everyday phrasings. Fri Oct 23 2026, 5:06 PM.
const fri = new Date(2026, 9, 23, 17, 6)
const when = (s: string) => {
  const r = parseReminderQuick(s, [], fri)
  const t = parseQuickAdd(s, [], undefined, fri)
  const f = (d: Date | null | undefined) =>
    d ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` : "-"
  return { r: `${r.title} | ${f(r.at)}${r.recurrence !== "NONE" ? " " + r.recurrence : ""}`, t: `${t.title} | ${f(t.due)}${t.repeat ? " " + t.repeat : ""}` }
}
ok("spoken reminders: what the recognizer typed", () => {
  const cases: [string, string][] = [
    ["play car insurance at 5:30 p.m. today", "play car insurance | Fri 10/23 17:30"],
    ["call Mom tomorrow at 8:00 a.m.", "call Mom | Sat 10/24 8:00"],
    ["dentist appointment next Tuesday at 3:00 p.m.", "dentist appointment | Tue 10/27 15:00"],
    ["remind me to feed the dog in 2 hours", "feed the dog | Fri 10/23 19:06"],
    ["take out the trash every Monday at 7:00 p.m.", "take out the trash | Mon 10/26 19:00 WEEKLY"],
    ["soccer practice Saturday at 10:15 in the morning", "soccer practice | Sat 10/24 10:15"],
    ["pay the water bill on October 30th", "pay the water bill | Fri 10/30 9:00"],
    ["call Grandma in half an hour", "call Grandma | Fri 10/23 17:36"],
    ["pick up kids at noon on Friday", "pick up kids | Fri 10/30 12:00"],
    ["take medicine tonight at 9", "take medicine | Fri 10/23 21:00"],
    ["call the bank in an hour", "call the bank | Fri 10/23 18:06"],
    ["pay rent on the 1st", "pay rent | Sun 11/1 9:00"],
    ["water plants this evening", "water plants | Fri 10/23 18:00"],
    ["call dad tomorrow morning", "call dad | Sat 10/24 9:00"],
    ["renew passport next week", "renew passport | Mon 10/26 9:00"],
    ["get gas at 6 o'clock", "get gas | Fri 10/23 18:00"],
    ["pay rent November 1st at 9 a.m.", "pay rent | Sun 11/1 9:00"],
    ["10/31 halloween party", "halloween party | Sat 10/31 9:00"],
    ["take meds at 8am daily", "take meds | Sat 10/24 8:00 DAILY"],
    ["lunch at noon tomorrow", "lunch | Sat 10/24 12:00"],
    ["pay monthly bill", "pay monthly bill | -"],
  ]
  for (const [said, want] of cases) assert.equal(when(said).r, want, said)
})
ok("spoken tasks: a time sets the due time, a day alone is due by its end, every… repeats", () => {
  assert.equal(when("pay the water bill on October 30th").t, "pay the water bill | Fri 10/30 23:59")
  assert.equal(when("call Mom tomorrow at 8:00 a.m.").t, "call Mom | Sat 10/24 8:00")
  assert.equal(when("take out the trash every Monday at 7:00 p.m.").t, "take out the trash | Mon 10/26 19:00 weekly")
  assert.equal(when("trash on Mondays").t, "trash | Mon 10/26 23:59 weekly")
  assert.equal(when("renew passport next week").t, "renew passport | Mon 10/26 23:59")
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

// Review fixes: late-night times, short weekday names inside words, same-day repeats.
ok("tonight at 12 / 12:30 tonight / Friday at midnight: after midnight, not noon", () => {
  const sat = new Date(2026, 9, 24, 10, 0) // Saturday 10:00
  const sunday0000 = new Date(2026, 9, 25, 0, 0).getTime()
  let r = parseReminderQuick("pick up dad tonight at 12", [], sat)
  assert.equal(r.at?.getTime(), sunday0000)
  assert.equal(r.title, "pick up dad")
  r = parseReminderQuick("call grandma 12:30 tonight", [], sat)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 25, 0, 30).getTime())
  r = parseReminderQuick("lock up tonight at 1", [], sat)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 25, 1, 0).getTime())
  r = parseReminderQuick("lights out tonight at midnight", [], sat)
  assert.equal(r.at?.getTime(), sunday0000)
  r = parseReminderQuick("submit form friday at midnight", [], sat)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 31, 0, 0).getTime(), "the night of Friday the 30th")
  r = parseReminderQuick("take meds tonight at 9", [], sat)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 24, 21, 0).getTime(), "9 stays 9 PM")
})
ok("tonight / this evening said late: an hour from now, not refused as past", () => {
  const late = new Date(2026, 9, 24, 22, 32)
  let r = parseReminderQuick("remind me to lock the door tonight", [], late)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 24, 23, 35).getTime())
  r = parseReminderQuick("water plants this evening", [], new Date(2026, 9, 24, 19, 2))
  assert.equal(r.at?.getTime(), new Date(2026, 9, 24, 20, 5).getTime())
  r = parseReminderQuick("water plants tonight", [], new Date(2026, 9, 24, 17, 0))
  assert.equal(r.at?.getTime(), new Date(2026, 9, 24, 20, 0).getTime(), "before 8 PM: 8 PM")
})
ok("short weekday names inside a sentence stay words", () => {
  let p = parseQuickAdd("buy sun hat", people, undefined, now)
  assert.equal(p.title, "buy sun hat")
  assert.equal(p.due, undefined)
  p = parseQuickAdd("SAT prep friday", people, undefined, now)
  assert.equal(p.title, "SAT prep")
  assert.equal(p.due?.getDay(), 5)
  p = parseQuickAdd("dentist fri at 3", people, undefined, now)
  assert.equal(p.title, "dentist")
  assert.equal(p.due?.getDay(), 5)
  assert.equal(p.due?.getHours(), 15)
  p = parseQuickAdd("practice on sat", people, undefined, now)
  assert.equal(p.due?.getDay(), 6)
})
ok("every Saturday said on a Saturday: task due today, reminder next week at 9", () => {
  const sat = new Date(2026, 9, 24, 10, 0)
  const p = parseQuickAdd("water plants every Saturday", people, undefined, sat)
  assert.equal(p.due?.toDateString(), sat.toDateString())
  assert.equal(p.repeat, "weekly")
  const r = parseReminderQuick("water plants every Saturday", [], sat)
  assert.equal(r.at?.getTime(), new Date(2026, 9, 31, 9, 0).getTime())
  const r2 = parseReminderQuick("water plants every Saturday at 9am", [], sat)
  assert.equal(r2.at?.getTime(), new Date(2026, 9, 31, 9, 0).getTime(), "a time that passed today: next week")
})

console.log(`${passed} passed`)
