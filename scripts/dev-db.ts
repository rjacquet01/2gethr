// Imported first by the scripts that use a real database (data-export,
// refresh-rotation, retention-purge). They run only against the Neon dev
// branch in .env.local: its DATABASE_URL replaces any in the shell, and there
// is no fallback to .env. Refuses to run without .env.local, or when its
// database is the one in a production env file.
import fs from 'fs'
import path from 'path'

const read = (f: string) => {
  try { return fs.readFileSync(path.join(process.cwd(), f), 'utf8') } catch { return '' }
}
// The Neon endpoint, so the pooled and direct hosts of one database match.
const endpoint = (url: string) => {
  try { return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '') } catch { return '' }
}

const devUrl = read('.env.local').match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)?.[1].trim()
if (!devUrl || !endpoint(devUrl)) {
  console.error('No DATABASE_URL in .env.local. These scripts run only against the Neon dev branch and never fall back to .env.')
  process.exit(1)
}
for (const f of ['.env', '.env.production', '.env.production.local']) {
  for (const m of read(f).matchAll(/^[A-Z_]*(?:DATABASE_URL|POSTGRES_URL)[A-Z_]*\s*=\s*"?([^"\r\n]+)"?/gm)) {
    if (endpoint(m[1]) === endpoint(devUrl)) {
      console.error(`DATABASE_URL in .env.local points at the database in ${f}. Point it at the dev branch.`)
      process.exit(1)
    }
  }
}
process.env.DATABASE_URL = devUrl
