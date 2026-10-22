# Children's data policy

Togethr is for adults 18+. A child is in Togethr only because a parent or legal guardian added them to their family, after seeing a short notice and ticking a consent box (unchecked by default). Nobody under 18 can create an account or join a family by themselves, and no invite code can create a child's account.

## What we collect from a child

| Data | When | Notes |
|---|---|---|
| Name (display name) | Parent adds the child | Required |
| Date of birth (or age) | Parent adds or edits it | Used for the age rules (own login from 8, adult at 18) |
| School, grade, emergency notes | Only if a parent adds them | Emergency notes are visible to parents only |
| Calendar events, tasks, messages, board posts | As the family uses the app | Created by the family |
| Email and password | Only if a parent gives the child their own login (any age, by the parent's invite) | No phone number is taken for a child |
| Location | Only if a parent turns it on | Off by default, including when a child's login is linked |
| Device push token | Only on a device where the child signs in and allows notifications | Used to deliver notifications |

**Not collected / not done:** no ads, no selling, no profiling, no third-party tracking. Vercel's page-view analytics is switched off on any device where a child has signed in (`components/privacy-analytics.tsx`).

## Consent record

Every child profile or child login is created with a consent row in `parental_consents`: family, parent user, child member (and child login once linked), scope (profile or account), consent text version, the exact text shown, IP, user agent, and time. Withdrawal sets `withdrawn_at` / `withdrawn_by`; the row is kept as proof.

## Who can see a child's data

- **Parents/guardians in that family:** everything above, including the consent records.
- **Other adults in the family:** the child's name, calendar and tasks as the family shares them; location only if it's on.
- **Guests:** never see children's details (no names on child lists, no birthdates, school, notes or location).
- **The child:** their own data through their login.
- **Togethr staff:** admin panel access only, protected by admin login with MFA, for support and legal requests.

## Retention

- Child profile data is kept while the child is in the family.
- **Removing a child, withdrawing consent, or deleting the family deletes the child's profile** (name, birthdate, school, notes), location settings and place assignments. A child's login is closed when consent is withdrawn, or when they are removed from their only family.
- Location history follows the family's plan and is never kept longer than 90 days (`lib/retention.ts`).
- Board posts and comments are purged on the same schedules as everyone's.
- **TODO:** confirm the database backup retention window (Neon point-in-time history) and state it here.

## Deletion requests

Parents delete in the app (Family > the child > Consent > Withdraw consent, or Remove), or by emailing admin@mytogethr.com. See `docs/COPPA_RUNBOOK.md`.

## Open items for counsel

- Whether the in-app checkbox is sufficient "verifiable parental consent" for under-13s, or a stronger method is needed.
- Child logins use an email address (it's the sign-in identifier). Should parents be told to use an address they control?
- Children added before consent was recorded (2 profiles existed on 2026-10-19) have no consent row.
