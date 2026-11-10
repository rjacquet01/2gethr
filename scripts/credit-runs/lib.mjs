// Shared helpers for the API-credit runs (security review, e2e drafts, Smart Import eval).
// The API key is NEVER stored in the repo. It is read from the ANTHROPIC_API_KEY
// environment variable, or from the file  %USERPROFILE%\.togethr-anthropic-key  (one line).
import Anthropic from "@anthropic-ai/sdk"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const OUT_DIR = path.join(process.cwd(), "scripts", "credit-runs", "out")
fs.mkdirSync(OUT_DIR, { recursive: true })

export function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim()
  const f = path.join(os.homedir(), ".togethr-anthropic-key")
  if (fs.existsSync(f)) {
    const k = fs.readFileSync(f, "utf8").trim()
    if (k) {
      process.env.ANTHROPIC_API_KEY = k
      return k
    }
  }
  console.error(`No API key. Put it in ${f} (one line) or set ANTHROPIC_API_KEY, then run again.`)
  process.exit(1)
}

export const MODEL = process.env.MODEL || "claude-opus-5-5"
// Stop before spending more than this many tokens in one run (input + output).
export const BUDGET_TOKENS = Number(process.env.BUDGET_TOKENS || 20_000_000)
export const usage = { input: 0, output: 0, calls: 0 }

let client
export function api() {
  if (!client) client = new Anthropic({ apiKey: loadKey(), maxRetries: 3, timeout: 180_000 })
  return client
}

/** One model call; returns the text. Tracks token usage and enforces the budget. */
export async function ask({ system, user, maxTokens = 4000, model = MODEL }) {
  if (usage.input + usage.output > BUDGET_TOKENS) throw new Error("BUDGET_TOKENS reached, stopping")
  const res = await api().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  })
  usage.calls++
  usage.input += res.usage?.input_tokens ?? 0
  usage.output += res.usage?.output_tokens ?? 0
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("")
}

/** Pull a JSON value out of a model reply (handles ```json fences and extra prose). */
export function parseJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[\[{]/)
  if (start < 0) throw new Error("no JSON in reply")
  const open = body[start]
  const end = body.lastIndexOf(open === "[" ? "]" : "}")
  return JSON.parse(body.slice(start, end + 1))
}

/** Run fn over items with limited concurrency. */
export async function pmap(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export function usageLine() {
  const inPrice = Number(process.env.PRICE_IN_PER_MTOK || 0)
  const outPrice = Number(process.env.PRICE_OUT_PER_MTOK || 0)
  const est = inPrice || outPrice ? `  est. $${((usage.input * inPrice + usage.output * outPrice) / 1e6).toFixed(2)}` : ""
  return `${usage.calls} calls, ${usage.input.toLocaleString()} input + ${usage.output.toLocaleString()} output tokens${est}`
}

export function walk(dir, test, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue
      walk(p, test, acc)
    } else if (test(p)) acc.push(p)
  }
  return acc
}
