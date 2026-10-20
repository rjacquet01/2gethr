# Security program

A one-page summary of the safeguards Togethr has today. Items marked **TODO** are not verified or not yet in place.

## Access controls

- **Users:** email and password. Passwords are hashed with bcrypt (cost 12). Optional two-factor authentication (TOTP) for users.
- **Sessions:** short-lived signed access tokens (15 minutes) and refresh tokens (7 days) that rotate on use and can be revoked. Cookies are httpOnly, Secure in production, SameSite=Lax.
- **Roles in a family:** parent, guardian, adult, child, guest, all checked on the server. Guests never see children's details or location. Only parents add children (with recorded consent) or manage invites. Invite codes are single-use, expire in 7 days, and are bound to a role.
- **Admins:** a separate admin login with its own secret, plus MFA (TOTP with backup codes).
- **Android background location:** a scoped device token for one family member, stored only as a SHA-256 hash, and revocable.
- **Rate limiting** on login, 2FA codes, password-reset emails and invite-code checks.

## Encryption

- **In transit:** HTTPS for all traffic (served by Vercel).
- **At rest:** the database (Neon Postgres) and file storage (Vercel Blob, private) are encrypted by those providers. **TODO:** keep the providers' current encryption statements on file.
- Files such as flyers and profile photos are served only through our own signed-in routes, never as public storage URLs. Photo uploads are re-encoded, which strips location data.

## Logging

- `audit_logs` records security-relevant actions with user, time, IP and user agent. These include account creation, consent, logins, member changes, deletions and admin actions.
- Server errors go to Vercel's runtime logs. Passwords, tokens and API keys are never logged.
- **TODO:** decide the audit log retention period and alerting.

## Data minimization and retention

- Location history is never kept longer than 90 days, or less on a family's plan. Children's data rules are in `docs/CHILDREN_DATA_POLICY.md`.
- Account deletion scrubs personal fields, revokes sessions, and deletes location history, memberships and personal content.
- Data export is available to every user in Settings.

## Vendors

Vercel (hosting, analytics, files), Neon (database), Stripe (payments), Resend (email), Google Firebase Cloud Messaging (push), OpenStreetMap-based services (maps/geocoding), Open-Meteo (weather). Each is listed in the Privacy Policy.

## Incident contact and response

- Report security issues to **admin@mytogethr.com**.
- On an incident: contain it (revoke tokens or keys, disable the feature), assess what data was affected, notify affected users and regulators as the law requires, then fix and write up the cause.
- **TODO:** a written incident response plan with notification timelines (counsel to confirm the legal deadlines).

## Annual review

Once a year, and after any major change:
- review this document, the Privacy Policy and the children's data policy against what the app actually does;
- review admin accounts and remove any that aren't needed;
- rotate secrets that are due (JWT, admin, webhook and API keys);
- review vendors' security and data processing terms;
- run a dependency audit.

**TODO:** set the first review date and an owner.
