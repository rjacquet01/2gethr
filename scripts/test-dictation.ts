// Usage: npx tsx --tsconfig tsconfig.json scripts/test-dictation.ts
// How dictated words join what's already typed (lib/dictation.ts).
// Pure function: no database, no network.
import assert from "node:assert"
import { appendDictation } from "../lib/dictation"

const cases: [string, string, string, string][] = [
  ["empty box: capitalised", "", "pick up milk", "Pick up milk"],
  ["after words: a space, no capital", "Pick up milk", "and bread", "Pick up milk and bread"],
  ["after a full stop: new sentence", "Pick up milk.", "then call mom", "Pick up milk. Then call mom"],
  ["after a question mark", "Ready?", "yes", "Ready? Yes"],
  ["trailing spaces in the box are tidied", "Soccer   ", "at four", "Soccer at four"],
  ["extra spaces in speech collapse", "", "  dentist   tuesday  ", "Dentist tuesday"],
  ["nothing heard: box unchanged", "Keep me", "   ", "Keep me"],
  ["already capitalised stays", "", "Sam's party", "Sam's party"],
]
for (const [name, current, spoken, want] of cases) assert.equal(appendDictation(current, spoken), want, name)
console.log(`${cases.length} passed`)
