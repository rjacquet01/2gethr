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
- `npm run lint`: baseline **419 problems: 1 error, 418 warnings**. The one
  error is `prefer-const` in `scripts/test-push-ownership.ts`. Add no new errors and
  no new warnings.
- `npm run test:e2e`: Playwright smoke test of the public pages (`/`, `/login`,
  `/privacy`, `/terms`), plus `/` and `/pricing` as the Android app sees them (no prices in the HTML).
  No sign-in, no writes. It starts `next dev` on port 3210.
  Next allows one `next dev` per checkout, so if one is already running use
  `E2E_PORT=<its port> npm run test:e2e`. The first time on a machine, run
  `npx playwright install chromium`. Browsers go in the user cache, not the repo.
- Play Store screens (scripts/demo): `npm run demo:seed` builds the fictional Rivera family on the
  dev branch (`demo:reset` removes it; `scripts/demo/guard.ts` refuses production). Its sign-in goes
  only to `.env.demo.local`. Then build, `next start -p 3124`, and `npm run demo:capture`: phone,
  7-inch and 10-inch PNGs plus a 1080x1920 walkthrough in `~/Downloads/play-raw`; `npm run demo:frame`
  adds captioned, framed copies in `play-raw/framed`. One sign-in per
  run; the login rate limit allows only a few runs per 15 minutes. Reseed after a capture (it checks a task off).

## Tests (scripts/test-*.ts)

Run each test **by name**: `npx tsx --tsconfig tsconfig.json scripts/test-<name>.ts`.
**Never loop over `scripts/test-*.ts`.** Some tests hit a real database or send
real email. Read a script's header before running it.

- **Safe, with no database and no network.** These use pure logic, or the
  in-memory fake through `__setSqlForTests`, with DATABASE_URL pointed at a closed port:
  admin-delete-child, admin-tier-breakdown, admin-token-refresh, adult-location-access, brand-logo, child-invite, coppa, cron-health,
  dashboard-prefetch, demo-guard, device-token-claim, existing-user-confirmations, family-invite, free-tier-limits, geofence, kid-ping, launch-security,
  legal-ping, location-dedupe, location-share-now, member-names, notification-dedupe, notification-link, push-ownership,
  dictation, place-alerts, push-picker, quick-add, schema-snapshot, sms-allowance, sms-consent, stillness, stripe-checkout-tax, task-due, trial-eligibility,
  stripe-webhook-events, telnyx-sms, twa-upgrade-links, upgrade-order, weather-prompt, weather-route.
- **Board suites** (board-flyer-download, board-flyers, board-limits,
  board-notify) need a disposable database in `BOARD_TEST_DATABASE_URL`.
  `scripts/board-test-db.ts` reads it from `.env.test.local` automatically, which points
  at the Neon `board-test` branch. It refuses any host found in `.env` or `.env.local`.
- **Real database, dev branch only:** data-export, retention-purge,
  refresh-rotation, and `scripts/cleanup-push-tokens.ts` (dry run unless `--apply`). Run them only when asked. `scripts/dev-db.ts` takes
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

- Adults must be 18 or older to sign up. Children never sign up on their own.
- Invites (Family > Invite) go by email link: Parent (another parent approves), Guest
  (calendar & tasks), Child (any age: creates the child profile with the parent's consent,
  and the child's account joins it). Add child is for kids without their own email; the
  parent tracks them from their own account.
- Kids create events, tasks and reminders with no parent approval. "Ask a parent" (child
  accounts only, `askParent: true`) makes one wait: events PENDING (`/api/events/[id]/approve`),
  tasks `assignment_status = PENDING_APPROVAL`, reminders `approval_status = PENDING_APPROVAL`
  (not fired until approved). A task one kid gives another kid still waits for that kid to accept.
- Show member names through `lib/member-names.ts` (`memberName`,
  `MEMBER_NAME_SQL`, `nameInFamily`, `actorNameInFamily`, `taskAssigneeName`,
  `participantName`). Don't hand-roll name fallbacks.
- Tiers live in `lib/subscription-tiers.ts`: `FREE` = Free, `PREMIUM` = **Plus**,
  `PREMIUM_PLUS` = **Premium**. Use the display names, not the enum names.
- Place (geofence) alerts: Free none, Plus 3 places, Premium every place (`limits.maxAlertPlaces`,
  `alertPlaceLimit()`). Enforced when a place is created or switched on (`lib/place-alerts.ts`) and when
  alerts fire (the family's oldest alert places), so a downgrade keeps only what the plan allows.
- Plan caps (Free / Plus / Premium, constants at the top of `lib/subscription-tiers.ts`): live location
  sharers at once 3 / 4 / all (children count); active reminders 5 / 30 / unlimited; new events a month 15 / 100 /
  unlimited (a repeating series counts once; imports and calendar sync don't count); board photo uploads
  kept 3 / 25 / 100; routine pushes a month 100 / 1000 / unlimited; location trail (`locationTrailDays`) 7 / 90 / 90 days;
  past events and task/reminder archives (`historyDays`) 30 / 90 / 90 days, hidden not deleted. Trials get
  Premium's caps. Enforced server-side by `lib/tier-limits.ts` (`checkLimit`, `claimMonthly`), which
  answers 402 `{ code: "PLAN_LIMIT", limit: {...} }`; rules and wording in `lib/plan-limits.ts`. Over a cap
  nothing is deleted or hidden, adding more is refused. Safety is never capped: only pushes marked
  `routineFamilyId` (`isRoutinePush` types) count; SOS, emergency, geofence, location and approval
  requests never do. Inside the Android app the limit copy is neutral, with no prices or upgrade links.
- Android app (TWA) and purchases: wrap every upgrade / "see plans" / pricing link in `<UpgradeGate>`
  (`components/upgrade-gate.tsx`; neutral "Manage your plan at mytogethr.com" in the app), or gate it on
  `usePurchaseUi().canPurchase`. `scripts/test-twa-upgrade-links.ts` fails on an ungated link. Server pages
  that show prices (`/`, `/pricing`) decide with `purchaseBlockedForPage` (`lib/android-app.ts`: the
  android-app:// referrer, the `togethr_android` cookie or `?source=android-app`) and leave priced parts
  out of the HTML for the app; `e2e/android-app.spec.ts` checks the HTML.
- Location: adults see children without sharing their own location. Adults see
  each other only after approval (`lib/location-access.ts`).
- Android background sharing uses device tokens (`lib/device-token.ts`), handed over by a
  togethr-bg:// link any page can open. App 1.2.6+ claims the token, which locks it until
  `/location/confirm-device` confirms it, signed in on the phone as the token's owner. A token
  from another account is revoked. Unclaimed tokens (older apps) work as before.
- Texts go only to numbers whose owner agreed (`users.sms_consent_at`, `lib/sms-consent.ts`),
  urgent alerts included; `lib/services/sms.ts` enforces it. Turning SMS on in Settings is the
  opt-in; a new number needs it again. Bodies start with "Togethr:". Inbound STOP/HELP:
  `/api/webhooks/twilio-sms`. Public opt-in page: `/sms-consent`.
- SMS provider: `SMS_PROVIDER` = `twilio` (default) or `telnyx` (`lib/services/sms.ts`). Gate sends on
  `isSmsConfigured()`, not a provider's own check. Inbound STOP/START/HELP for both providers is
  `lib/sms-inbound.ts`; Telnyx posts to `/api/webhooks/telnyx-sms` (Ed25519, `TELNYX_PUBLIC_KEY`).
- Logo: `components/brand/logo.tsx` (`Logo`, variant `logotype` | `mark`, tone `color` | `reversed` | `auto`).
  The logotype already spells "Togethr" with the T, so never put the T-mark or the word "Togethr" next to it;
  the mark alone only where width is under ~90px. Motto: `BRAND_MOTTO` ("Connect people, connect events.").
  Emails get the hosted logotype PNG (`lib/services/email.ts`, `brandEmailHtml`).
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
