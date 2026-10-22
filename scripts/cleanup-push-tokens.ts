// Usage: npx tsx --tsconfig tsconfig.json scripts/cleanup-push-tokens.ts [--apply]
//
// One-time cleanup: one active push token per browser. For each user, keeps
// the newest active token per browser endpoint, then per browser (platform +
// device_info browser label, matching registerPushToken in
// lib/services/push.ts), and deactivates the rest (is_active = false; nothing
// is deleted). Dry run by default: prints what it would change. --apply writes.
// Dev branch only (scripts/dev-db.ts): it never falls back to production.
import './dev-db'

type TokenRow = { token: string; user_id: string; platform: string; browser: string | null; updated_at: string | null }

const endpointOf = (token: string) => {
  try {
    const p = JSON.parse(token)
    if (p && typeof p.endpoint === 'string') return p.endpoint
  } catch {}
  return token
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { sql } = await import('../lib/db')

  const rows = (await sql`
    SELECT token, user_id, platform, device_info->>'browser' AS browser, updated_at
    FROM push_tokens WHERE is_active = true
    ORDER BY user_id, updated_at DESC NULLS LAST
  `) as TokenRow[]

  const retire = new Set<string>()
  const byUser = new Map<string, TokenRow[]>()
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r])

  const report: { user: string; active: number; sameEndpoint: number; sameBrowser: number; keeps: number }[] = []
  for (const [user, list] of byUser) {
    // Newest first (ORDER BY above), so the first of each group is kept.
    const endpoints = new Set<string>()
    let sameEndpoint = 0
    for (const r of list) {
      const ep = endpointOf(r.token)
      if (endpoints.has(ep)) { retire.add(r.token); sameEndpoint++ } else endpoints.add(ep)
    }
    const browsers = new Set<string>()
    let sameBrowser = 0
    for (const r of list) {
      if (retire.has(r.token) || r.platform !== 'web' || !r.browser) continue
      const key = `${r.platform}|${r.browser}`
      if (browsers.has(key)) { retire.add(r.token); sameBrowser++ } else browsers.add(key)
    }
    report.push({ user: user.slice(0, 8), active: list.length, sameEndpoint, sameBrowser, keeps: list.length - sameEndpoint - sameBrowser })
  }

  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${rows.length} active tokens across ${byUser.size} users`)
  for (const r of report) {
    console.log(`  user ${r.user}…  active ${r.active}  duplicate endpoint ${r.sameEndpoint}  same browser ${r.sameBrowser}  -> keeps ${r.keeps}`)
  }
  console.log(`would deactivate ${retire.size} token(s)`)

  if (apply && retire.size > 0) {
    const tokens = [...retire]
    const done = await sql`
      UPDATE push_tokens SET is_active = false, updated_at = NOW()
      WHERE is_active = true AND token = ANY(${tokens}::text[])
      RETURNING token
    `
    console.log(`deactivated ${done.length} token(s)`)
  } else if (!apply) {
    console.log('nothing written (dry run). Re-run with --apply to deactivate them.')
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
