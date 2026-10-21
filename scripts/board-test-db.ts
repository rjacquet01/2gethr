// Imported first by the board tests (flyers, limits, notify), which create and
// delete rows in a real database. They run only against a disposable test
// database named explicitly in BOARD_TEST_DATABASE_URL (e.g. a Neon branch),
// never the DATABASE_URL in .env or the shell, and refuse a URL whose host is
// the one in any .env file.
import fs from 'fs'
import path from 'path'

const host = (url: string) => {
  try { return new URL(url).hostname } catch { return '' }
}

// Not set in the environment: take it from .env.test.local (git-ignored), so
// the tests run with a plain `npx tsx scripts/test-board-*.ts` and nobody has
// to read env files in the shell.
if (!process.env.BOARD_TEST_DATABASE_URL) {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), '.env.test.local'), 'utf8').match(/^BOARD_TEST_DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m)
    if (m) process.env.BOARD_TEST_DATABASE_URL = m[1].trim()
  } catch {}
}
const testUrl = process.env.BOARD_TEST_DATABASE_URL
if (!testUrl) {
  console.error('Set BOARD_TEST_DATABASE_URL to a disposable test database (e.g. a Neon branch). These tests never use DATABASE_URL.')
  process.exit(1)
}
for (const f of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.development', '.env.development.local']) {
  let text = ''
  try { text = fs.readFileSync(path.join(process.cwd(), f), 'utf8') } catch { continue }
  for (const m of text.matchAll(/^[A-Z_]*(?:DATABASE_URL|POSTGRES_URL)[A-Z_]*\s*=\s*"?([^"\r\n]+)"?/gm)) {
    if (host(m[1]) && host(m[1]) === host(testUrl)) {
      console.error(`BOARD_TEST_DATABASE_URL points at the database in ${f}. Use a separate test database.`)
      process.exit(1)
    }
  }
}
process.env.DATABASE_URL = testUrl
