// The demo family only ever goes into the Neon dev branch (.env.local), never
// production. Same rule as scripts/dev-db.ts, plus NODE_ENV / VERCEL_ENV.
import fs from "fs"
import path from "path"

/** The Neon endpoint, so the pooled and direct hosts of one database match. */
export function dbEndpoint(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0].replace(/-pooler$/, "")
  } catch {
    return ""
  }
}

/** Why the demo scripts must not run against this database; null when it's the dev branch. */
export function demoDbProblem(opts: {
  nodeEnv?: string
  vercelEnv?: string
  devUrl?: string | null
  productionUrls: string[]
}): string | null {
  if (opts.nodeEnv === "production" || opts.vercelEnv === "production") {
    return "Refusing to run with NODE_ENV/VERCEL_ENV=production. The demo family is for the dev branch only."
  }
  const dev = opts.devUrl ? dbEndpoint(opts.devUrl) : ""
  if (!dev) return "No DATABASE_URL in .env.local. The demo scripts run only against the Neon dev branch."
  if (opts.productionUrls.some((u) => dbEndpoint(u) === dev)) {
    return "DATABASE_URL in .env.local is the production database. Point it at the dev branch."
  }
  return null
}

const read = (f: string) => {
  try {
    return fs.readFileSync(path.join(process.cwd(), f), "utf8")
  } catch {
    return ""
  }
}

/** Points DATABASE_URL at the dev branch, or exits. Never prints the URL. */
export function pointAtDevDatabaseOrExit(): void {
  const devUrl = read(".env.local").match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1].trim()
  const productionUrls: string[] = []
  for (const f of [".env", ".env.production", ".env.production.local"]) {
    for (const m of read(f).matchAll(/^[A-Z_]*(?:DATABASE_URL|POSTGRES_URL)[A-Z_]*\s*=\s*"?([^"\r\n]+)"?/gm)) productionUrls.push(m[1])
  }
  const problem = demoDbProblem({ nodeEnv: process.env.NODE_ENV, vercelEnv: process.env.VERCEL_ENV, devUrl, productionUrls })
  if (problem) {
    console.error(problem)
    process.exit(1)
  }
  process.env.DATABASE_URL = devUrl
}
