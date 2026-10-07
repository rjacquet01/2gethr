import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import bcrypt from "bcryptjs"
import { sql } from "./db"
import { getTierDefinition } from "./subscription-tiers"

// JWT Configuration
// SECURITY FIX: these used to fall back to hardcoded, publicly-known strings
// if the env vars weren't set, which would let anyone forge valid login
// tokens in an environment that was missing configuration. Fail loudly
// instead.
if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET environment variables must be set"
  )
}
const ACCESS_TOKEN_SECRET = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET)
const REFRESH_TOKEN_SECRET = new TextEncoder().encode(process.env.JWT_REFRESH_SECRET)

const ACCESS_TOKEN_EXPIRY = "15m"
const REFRESH_TOKEN_EXPIRY = "7d"

// ============================================
// Types
// ============================================

export interface JWTPayload {
  userId: string
  type: "access" | "refresh" | "2fa_challenge"
  iat?: number
  exp?: number
}

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  profilePhotoUrl: string | null
  profilePhotoPath: string | null
  timezone: string
  isActive: boolean
  emailVerified: Date | null
  createdAt: Date
}

export interface UserWithFamily extends AuthUser {
  primaryFamily: {
    id: string
    name: string
    ownerId: string
  } | null
  primaryFamilyRole: string | null
  primaryFamilyMemberId: string | null
  permissions: MemberPermissions | null
}

export interface MemberPermissions {
  canCreateEvents: boolean
  requiresEventApproval: boolean
  canOverrideConflicts: boolean
  canViewFamilyCalendar: boolean
  canInviteMembers: boolean
}

export interface AuthResult {
  user: UserWithFamily | null
  error: string | null
}

// ============================================
// Password Utilities
// ============================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ============================================
// JWT Token Generation
// ============================================

export async function generateAccessToken(userId: string): Promise<string> {
  return new SignJWT({ userId, type: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(ACCESS_TOKEN_SECRET)
}

export async function generateRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ userId, type: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(REFRESH_TOKEN_SECRET)
}

// A short-lived token identifying a user who has passed the password check
// at login but still needs to submit a 2FA code. Deliberately signed with
// the access-token secret but with a distinct `type`, so it can never be
// accepted by verifyAccessToken() (which checks `type === "access"`) even
// if it leaked — it's only useful at the /api/auth/2fa/verify endpoint,
// and only for 5 minutes.
const TWO_FACTOR_CHALLENGE_EXPIRY = "5m"

export async function generateTwoFactorChallengeToken(userId: string): Promise<string> {
  return new SignJWT({ userId, type: "2fa_challenge" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TWO_FACTOR_CHALLENGE_EXPIRY)
    .sign(ACCESS_TOKEN_SECRET)
}

export async function verifyTwoFactorChallengeToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_TOKEN_SECRET)
    if (payload.type !== "2fa_challenge") return null
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, ACCESS_TOKEN_SECRET)
    if (payload.type !== "access") return null
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

export async function verifyRefreshToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, REFRESH_TOKEN_SECRET)
    if (payload.type !== "refresh") return null
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

export async function generateTokenPair(
  userId: string,
  sessionMeta?: { userAgent?: string; ipAddress?: string }
) {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(userId),
    generateRefreshToken(userId),
  ])

  // Store refresh token in database. userAgent/ipAddress are captured here
  // (rather than looked up later) so the Settings > Security "Active
  // Sessions" list can show each session's device without having to
  // correlate against audit_logs, which isn't reliably 1:1 with a session
  // (token refreshes don't log an audit event at all).
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  await sql`
    INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at, user_agent, ip_address)
    VALUES (
      ${crypto.randomUUID()}, ${userId}, ${refreshToken}, ${expiresAt.toISOString()}, NOW(),
      ${sessionMeta?.userAgent || null}, ${sessionMeta?.ipAddress || null}
    )
  `

  return { accessToken, refreshToken }
}
// ============================================
// Cookie Management
// ============================================

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies()

  cookieStore.set("access_token", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60, // 15 minutes
    path: "/",
  })

  cookieStore.set("refresh_token", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
    path: "/",
  })
}

export async function clearAuthCookies() {
  const cookieStore = await cookies()
  cookieStore.delete("access_token")
  cookieStore.delete("refresh_token")
}

// ============================================
// User Retrieval
// ============================================

export async function getUserById(userId: string): Promise<AuthUser | null> {
  const users = await sql`
    SELECT 
      id, email, first_name, last_name, phone,
      profile_photo_url, profile_photo_path, timezone,
      is_active, email_verified, created_at
    FROM users 
    WHERE id = ${userId} AND is_active = true
  `

  if (users.length === 0) return null

  const user = users[0]
  return {
    id: user.id,
    email: user.email,
    firstName: user.first_name,
    lastName: user.last_name,
    phone: user.phone,
    profilePhotoUrl: user.profile_photo_url,
    profilePhotoPath: user.profile_photo_path,
    timezone: user.timezone,
    isActive: user.is_active,
    emailVerified: user.email_verified,
    createdAt: user.created_at,
  }
}

export async function getUserWithFamily(userId: string): Promise<UserWithFamily | null> {
  const user = await getUserById(userId)
  if (!user) return null

  // Get primary family membership (owned family first, otherwise first active membership)
  const memberships = await sql`
    SELECT 
      fm.id as member_id,
      fm.role,
      fm.can_create_events,
      fm.requires_event_approval,
      fm.can_override_conflicts,
      fm.can_view_family_calendar,
      fm.can_invite_members,
      f.id as family_id,
      f.name as family_name,
      f.owner_id
    FROM family_members fm
    JOIN families f ON fm.family_id = f.id
    WHERE fm.user_id = ${userId} AND fm.is_active = true
    ORDER BY (f.owner_id = ${userId}) DESC, fm.joined_at ASC
    LIMIT 1
  `

  if (memberships.length === 0) {
    return {
      ...user,
      primaryFamily: null,
      primaryFamilyRole: null,
      primaryFamilyMemberId: null,
      permissions: null,
    }
  }

  const membership = memberships[0]
  return {
    ...user,
    primaryFamily: {
      id: membership.family_id,
      name: membership.family_name,
      ownerId: membership.owner_id,
    },
    primaryFamilyRole: membership.role,
    primaryFamilyMemberId: membership.member_id,
    permissions: {
      canCreateEvents: membership.can_create_events,
      requiresEventApproval: membership.requires_event_approval,
      canOverrideConflicts: membership.can_override_conflicts,
      canViewFamilyCalendar: membership.can_view_family_calendar,
      canInviteMembers: membership.can_invite_members,
    },
  }
}

// ============================================
// Authentication Flow
// ============================================

/**
 * Get user from request - checks Authorization header first, then cookies
 * Use this for API routes that need to support both token-based and cookie-based auth
 */
export async function getUserFromRequest(request: Request): Promise<AuthResult> {
  // First try Authorization header
  const authHeader = request.headers.get("Authorization")
  let accessToken: string | undefined
  
  if (authHeader?.startsWith("Bearer ")) {
    accessToken = authHeader.substring(7)
  }
  
  // Fallback to cookies
  if (!accessToken) {
    const cookieStore = await cookies()
    accessToken = cookieStore.get("access_token")?.value
  }
  
  if (!accessToken) {
    return { user: null, error: "No authentication token" }
  }
  
  const payload = await verifyAccessToken(accessToken)
  if (!payload) {
    return { user: null, error: "Invalid access token" }
  }
  
  const user = await getUserWithFamily(payload.userId)
  if (!user) {
    return { user: null, error: "User not found" }
  }
  
  return { user, error: null }
}

export async function getCurrentUser(): Promise<AuthResult> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value
  const refreshToken = cookieStore.get("refresh_token")?.value

  if (!accessToken) {
    if (refreshToken) {
      return refreshAccessToken(refreshToken)
    }
    return { user: null, error: "No authentication token" }
  }

  const payload = await verifyAccessToken(accessToken)
  if (!payload) {
    if (refreshToken) {
      return refreshAccessToken(refreshToken)
    }
    return { user: null, error: "Invalid access token" }
  }

  const user = await getUserWithFamily(payload.userId)
  if (!user) {
    return { user: null, error: "User not found" }
  }

  return { user, error: null }
}

async function refreshAccessToken(refreshToken: string): Promise<AuthResult> {
  const payload = await verifyRefreshToken(refreshToken)
  if (!payload) {
    return { user: null, error: "Invalid refresh token" }
  }

  // Verify refresh token exists in database and is not revoked
  const tokens = await sql`
    SELECT id FROM refresh_tokens 
    WHERE user_id = ${payload.userId} 
    AND token = ${refreshToken}
    AND revoked_at IS NULL 
    AND expires_at > NOW()
  `

  if (tokens.length === 0) {
    return { user: null, error: "Refresh token invalid or expired" }
  }

  // Generate new tokens
  const newTokens = await generateTokenPair(payload.userId)
  await setAuthCookies(newTokens.accessToken, newTokens.refreshToken)

  // Revoke old refresh token
  await sql`
    UPDATE refresh_tokens 
    SET revoked_at = NOW() 
    WHERE token = ${refreshToken}
  `

  const user = await getUserWithFamily(payload.userId)
  if (!user) {
    return { user: null, error: "User not found" }
  }

  return { user, error: null }
}

// ============================================
// Auth Guards
// ============================================

export async function requireAuth(): Promise<UserWithFamily> {
  const { user, error } = await getCurrentUser()
  if (!user) {
    throw new Error(error || "Authentication required")
  }
  return user
}

export async function requireRole(allowedRoles: string[]): Promise<UserWithFamily> {
  const user = await requireAuth()

  if (!user.primaryFamilyRole || !allowedRoles.includes(user.primaryFamilyRole)) {
    throw new Error("Insufficient permissions")
  }

  return user
}

export async function requireFamilyMember(familyId: string): Promise<UserWithFamily> {
  const user = await requireAuth()

  if (!user.primaryFamily || user.primaryFamily.id !== familyId) {
    // Check if user is member of the specified family
    const memberships = await sql`
      SELECT id FROM family_members 
      WHERE user_id = ${user.id} 
      AND family_id = ${familyId} 
      AND is_active = true
    `
    if (memberships.length === 0) {
      throw new Error("Not a member of this family")
    }
  }

  return user
}

// ============================================
// Token Revocation
// ============================================

export async function revokeRefreshToken(token: string) {
  await sql`
    UPDATE refresh_tokens 
    SET revoked_at = NOW() 
    WHERE token = ${token}
  `
}

export async function revokeAllUserTokens(userId: string) {
  await sql`
    UPDATE refresh_tokens 
    SET revoked_at = NOW() 
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `
}

// ============================================
// Audit Logging
// ============================================

export async function logAuditEvent(
  userId: string | null,
  action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT" | "VIEW" | "EXPORT",
  entityType: string,
  entityId: string,
  options?: {
    oldValue?: Record<string, unknown>
    newValue?: Record<string, unknown>
    metadata?: Record<string, unknown>
    ipAddress?: string
    userAgent?: string
  }
) {
  await sql`
    INSERT INTO audit_logs (
      id, user_id, action, entity_type, entity_id,
      old_value, new_value, metadata, ip_address, user_agent, created_at
    )
    VALUES (
      ${crypto.randomUUID()},
      ${userId},
      ${action},
      ${entityType},
      ${entityId},
      ${options?.oldValue ? JSON.stringify(options.oldValue) : null},
      ${options?.newValue ? JSON.stringify(options.newValue) : null},
      ${options?.metadata ? JSON.stringify(options.metadata) : null},
      ${options?.ipAddress || null},
      ${options?.userAgent || null},
      NOW()
    )
  `
}

// ============================================
// Subscription Checking
// ============================================

export async function checkFamilySubscription(familyId: string): Promise<{
  tier: string
  isActive: boolean
  features: {
    maxFamilyMembers: number
    maxChildren: number
    maxSavedPlaces: number
    maxCalendars: number
    locationSharing: boolean
    geofencing: boolean
    phoneAlerts: boolean
    smsNotifications: boolean
    customReminderTimes: boolean
    historyDays: number
  }
}> {
  const subscriptions = await sql`
    SELECT tier, status, trial_ends_at
    FROM subscriptions 
    WHERE family_id = ${familyId} 
    AND status IN ('ACTIVE', 'TRIALING')
    ORDER BY created_at DESC
    LIMIT 1
  `

  // Limits and feature flags come from lib/subscription-tiers.ts (the single
  // source of truth) instead of a second hand-maintained copy here.
  const toFeatures = (tier: string) => {
    const def = getTierDefinition(tier)
    return {
      maxFamilyMembers: def.limits.maxFamilyMembers,
      maxChildren: def.limits.maxChildren,
      maxSavedPlaces: def.limits.maxSavedPlaces,
      maxCalendars: def.limits.maxCalendars,
      locationSharing: def.features.locationSharing,
      geofencing: def.features.geofencing,
      phoneAlerts: def.features.phoneAlerts,
      smsNotifications: def.features.smsNotifications,
      customReminderTimes: def.features.customReminderTimes,
      historyDays: def.limits.historyDays,
    }
  }

  if (subscriptions.length === 0) {
    return { tier: "FREE", isActive: true, features: toFeatures("FREE") }
  }

  const sub = subscriptions[0]

  // A trial whose end date has passed is no longer premium, even if the row
  // still says TRIALING (nothing may have flipped it yet).
  const trialExpired =
    sub.status === "TRIALING" &&
    !!sub.trial_ends_at &&
    new Date(sub.trial_ends_at).getTime() < Date.now()
  if (trialExpired) {
    return { tier: "FREE", isActive: true, features: toFeatures("FREE") }
  }

  return {
    tier: sub.tier,
    isActive: true,
    features: toFeatures(sub.tier),
  }
}
