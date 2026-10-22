# Togethr (mytogethr.com)

A family app: shared calendar, tasks, board, chat, location sharing with
geofences, push and email notifications, Stripe subscriptions, and an admin
portal (support, legal requests). Preparing for a soft launch.

## Stack

- Next.js 16 App Router, React 19, TypeScript 5.7, Tailwind 4, SWR.
- Neon Postgres through `@neondatabase/serverless`: `sql` tagged templates
  only (lib/db.ts). No ORM, no fragment composition.
- Vercel. Functions are pinned to cle1, close to the database in Neon us-east-2.
- Stripe (billing), Resend (email), web push, Vercel Blob (board flyers).

## Commands

- `npm run dev`: local dev server. Reads `.env.local` (the Neon **dev** branch).
- `npm run build`: locally this needs a placeholder Stripe key:
  `STRIPE_SECRET_KEY=sk_test_placeholder_local_build_only npm run build`.
  The build rewrites `next-env.d.ts`, so revert it with `git checkout -- next-env.d.ts`.
- `npx tsc --noEmit`: baseline **0 errors**. Keep it at 0.
- `npm run lint`: baseline **422 problems: 1 error, 421 warnings**. The one
  error is in `app/(dashboard)/settings/calendar-sync/page.tsx`. Add no new errors and
  no new warnings.
- `npm run test:e2e`: Playwright smoke test of the public pages (`/`, `/login`,
  `/privacy`, `/terms`). No sign-in, no writes. It starts `next dev` on port 3210.
  Next allows one `next dev` per checkout, so if one is already running use
  `E2E_PORT=<its port> npm run test:e2e`. The first time on a machine, run
  `npx playwright install chromium`. Browsers go in the user cache, not the repo.

## Tests (scripts/test-*.ts)

Run each test **by name**: `npx tsx --tsconfig tsconfig.json scripts/test-<name>.ts`.
**Never loop over `scripts/test-*.ts`.** Some tests hit a real database or send
real email. Read a script's header before running it.

- **Safe, with no database and no network.** These use pure logic, or the
  in-memory fake through `__setSqlForTests`, with DATABASE_URL pointed at a closed port:
  admin-delete-child, admin-tier-breakdown, adult-location-access, coppa,
  dashboard-prefetch, existing-user-confirmations, geofence, launch-security,
  legal-ping, location-dedupe, location-share-now, member-names, push-ownership,
  push-picker, schema-snapshot, stillness, stripe-checkout-tax,
  stripe-webhook-events, weather-prompt, weather-route.
- **Board suites** (board-flyer-download, board-flyers, board-limits,
  board-notify) need a disposable database in `BOARD_TEST_DATABASE_URL`.
  `scripts/board-test-db.ts` reads it from `.env.test.local` automatically, which points
  at the Neon `board-test` branch. It refuses any host found in `.env` or `.env.local`.
- **Real database, dev branch only:** data-export, retention-purge,
  refresh-rotation. Run them only when asked. `scripts/dev-db.ts` takes
  DATABASE_URL from `.env.local` only and never falls back to `.env`. It refuses
  to run when `.env.local` is missing or points at a production database.
- **Never run these:** email, weekly-digest, welcome-invite. They send real email.
- Known failures: none. Every suite above passes on main.

## Hard rules

- NEVER run anything against the production DATABASE_URL or the database in
  any .env; board tests use only BOARD_TEST_DATABASE_URL (disposable Neon branch).
- Never log secrets, tokens, TOTP secrets or full coordinates.
- No third-party service may receive user data without my say-so.
- Do not weaken auth, rate limits, or the family-membership checks.
- Every new SQL uses tagged-template parameters.
- The legal access log is append-only. The trigger `legal_access_log_immutable` enforces it.
- Never read or print `.env*` files in the shell. Never edit `.env`, Vercel, or Stripe
  settings unless asked.

## Workflow

- Branch from `main`, and use one branch per task. Commit with a clear message.
- Before a PR: run `npx tsc --noEmit` (0 errors), `npm run lint` (no new problems),
  the relevant safe tests by name, and `npm run test:e2e` when pages changed.
- Open the PR with `gh pr create` and merge with `gh pr merge --merge` once checks
  pass. A prompt that says "Do NOT merge" overrides this.
- Confirm the Vercel deploy:
  `gh api repos/rjacquet01/2gethr/commits/<sha>/status`.
- If npm drops `node_modules/@next/swc-win32-x64-msvc` from package-lock.json,
  restore that entry from main. `npm ci --dry-run` must succeed.
- Write code that matches the surrounding code. Keep comments short and only where they help.

## Product facts

- Adults must be 18 or older to sign up. Children are added by a parent, never sign up.
- Show member names through `lib/member-names.ts` (`memberName`,
  `MEMBER_NAME_SQL`, `nameInFamily`, `actorNameInFamily`, `taskAssigneeName`,
  `participantName`). Don't hand-roll name fallbacks.
- Tiers live in `lib/subscription-tiers.ts`: `FREE` = Free, `PREMIUM` = **Plus**,
  `PREMIUM_PLUS` = **Premium**. Use the display names, not the enum names.
- Location: adults see children without sharing their own location. Adults see
  each other only after approval (`lib/location-access.ts`).
- Cold-start schema setup is skipped when the catalog snapshot shows it is
  already applied (`lib/schema-snapshot.ts`, the `ddl` tag).

## Claude Code hooks (.claude/settings.json)

- **PreToolUse, Bash/PowerShell** (`.claude/hooks/guard-shell.mjs`) blocks commands
  that read or print `.env` files. It also blocks `rm -rf` outside `node_modules`/`.next`,
  `git push --force` and its variants (`-f`, `--force-with-lease`, `+refspec`),
  and any command that names the production database host. The hook reads that
  host from `.env` each time it runs, and it is never written into the repo.
  The guard matches on command text, so it also blocks a heredoc that only
  mentions one of these patterns. Write commit or PR text to a file first, then use
  `git commit -F <file>` or `gh pr create --body-file <file>`.
- **PostToolUse, Edit/Write** (`.claude/hooks/check-changed.mjs`) runs after a
  `.ts` or `.tsx` edit. It runs the incremental type check and ESLint (errors only),
  and reports problems in that file. It never blocks.
- Personal overrides go in `.claude/settings.local.json`, which git ignores.
