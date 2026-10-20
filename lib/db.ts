import { neon } from "@neondatabase/serverless"

// Neon serverless SQL client for raw queries
const client = neon(process.env.DATABASE_URL!)

// Tests can route every query to an in-memory fake (scripts/test-coppa.ts),
// so route-level tests never touch a real database. Refused in production.
let testOverride: typeof client | null = null
export function __setSqlForTests(fake: typeof client | null): void {
  if (process.env.NODE_ENV === "production") throw new Error("__setSqlForTests is not available in production")
  testOverride = fake
}

export const sql = new Proxy(client, {
  apply: (target, thisArg, args) => Reflect.apply(testOverride ?? target, thisArg, args),
  get: (target, prop) => Reflect.get(testOverride ?? target, prop),
}) as typeof client

export default sql
