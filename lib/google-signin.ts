import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose"
import { ddl } from "./schema-snapshot"

// Sign in with Google (sign-in only: scopes openid, email, profile; the Google
// Calendar connection in app/api/calendar-sync/google is a separate flow).
//
// Rules this feature keeps:
//  - Off until NEXT_PUBLIC_GOOGLE_SIGN_IN=true (so it can ship dark until the
//    redirect URI below is added in Google Cloud Console).
//  - Never links to an existing password account on an email match: the email
//    of a password sign-up was never verified, so linking would let someone
//    who pre-registered an address keep a way into the real owner's account.
//  - A new account is only created after the person confirms they are 18+
//    and accepts the Terms (app/api/auth/google/complete), as /register does.

export const GOOGLE_SIGNIN_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === "true"

export const GOOGLE_NONCE_COOKIE = "google_signin_nonce"
export const GOOGLE_NEXT_COOKIE = "google_signin_next"
export const GOOGLE_SIGNUP_COOKIE = "google_signup"
export const GOOGLE_HANDOFF_COOKIE = "google_handoff"
/** The state's user slot is not a user: it marks a sign-in flow (the Calendar flow uses its own cookie, so the two can't be swapped). */
export const GOOGLE_STATE_SUBJECT = "google-signin"
export const GOOGLE_FLOW_MAX_AGE_SEC = 15 * 60
export const GOOGLE_HANDOFF_MAX_AGE_SEC = 2 * 60

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"))

const SIGNUP_SECRET = () => new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)

export interface GoogleIdentity {
  sub: string
  email: string
  name: string
  givenName: string
  familyName: string
}

/** Checks a Google ID token's signature, issuer, audience and expiry, and that Google has verified the email. */
export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdentity | null> {
  try {
    const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    })
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null
    if (payload.email_verified !== true) return null
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      name: typeof payload.name === "string" ? payload.name : "",
      givenName: typeof payload.given_name === "string" ? payload.given_name : "",
      familyName: typeof payload.family_name === "string" ? payload.family_name : "",
    }
  } catch {
    return null
  }
}

/** A short-lived proof, in an httpOnly cookie, that Google vouched for this identity; spent when the account is created. */
export async function signGoogleSignup(id: GoogleIdentity): Promise<string> {
  return new SignJWT({ type: "google_signup", sub: id.sub, email: id.email, name: id.name, given: id.givenName, family: id.familyName })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${GOOGLE_FLOW_MAX_AGE_SEC}s`)
    .sign(SIGNUP_SECRET())
}

export async function verifyGoogleSignup(token: string | undefined): Promise<GoogleIdentity | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, SIGNUP_SECRET())
    if (payload.type !== "google_signup" || typeof payload.sub !== "string" || typeof payload.email !== "string") return null
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      givenName: typeof payload.given === "string" ? payload.given : "",
      familyName: typeof payload.family === "string" ? payload.family : "",
    }
  } catch {
    return null
  }
}

/** Only same-site paths, as the login page does. */
export function safeNextPath(value: string | null | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && !value.startsWith("/login")) return value
  return "/dashboard"
}

let ensured: Promise<void> | null = null

/** Adds users.google_sub (the Google account's stable id) the first time it is needed. */
export function ensureGoogleSchema(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT`
      await ddl`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
