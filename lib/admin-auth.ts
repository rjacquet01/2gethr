import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { verifyAdminMfaCode } from './admin-mfa'
import { sql } from '@/lib/db'

// Admin JWT configuration (separate from consumer)
// SECURITY FIX: previously fell back to a hardcoded, publicly-known string if
// no env var was set, which would let anyone forge a valid admin session.
if (!process.env.ADMIN_JWT_SECRET && !process.env.JWT_SECRET) {
  throw new Error('ADMIN_JWT_SECRET (or JWT_SECRET) environment variable must be set')
}
const ADMIN_JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET
)
const ADMIN_ACCESS_TOKEN_EXPIRY = '15m'
const ADMIN_REFRESH_TOKEN_EXPIRY = '8h' // Shorter for admin sessions
export const ADMIN_ACCESS_COOKIE = 'admin_access_token'
export const ADMIN_REFRESH_COOKIE = 'admin_refresh_token'

// Types
export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  status: string
  mfaEnabled: boolean
  roles: string[]
  permissions: string[]
}

export interface AdminTokenPayload {
  sub: string // admin_user_id
  email: string
  roles: string[]
  permissions: string[]
  type: 'admin_access' | 'admin_refresh'
  iat: number
  exp: number
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Get admin user's roles and permissions
async function getAdminRolesAndPermissions(adminUserId: string): Promise<{
  roles: string[]
  permissions: string[]
}> {
  const rolesResult = await sql`
    SELECT r.name
    FROM admin_roles r
    JOIN admin_user_roles ur ON r.id = ur.role_id
    WHERE ur.admin_user_id = ${adminUserId}
  `
  
  const permissionsResult = await sql`
    SELECT DISTINCT p.key
    FROM admin_permissions p
    JOIN admin_role_permissions rp ON p.id = rp.permission_id
    JOIN admin_user_roles ur ON rp.role_id = ur.role_id
    WHERE ur.admin_user_id = ${adminUserId}
  `
  
  return {
    roles: rolesResult.map(r => r.name),
    permissions: permissionsResult.map(p => p.key),
  }
}

// Generate admin access token
export async function generateAdminAccessToken(admin: AdminUser): Promise<string> {
  return new SignJWT({
    sub: admin.id,
    email: admin.email,
    roles: admin.roles,
    permissions: admin.permissions,
    type: 'admin_access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ADMIN_ACCESS_TOKEN_EXPIRY)
    .sign(ADMIN_JWT_SECRET)
}

// Generate admin refresh token
export async function generateAdminRefreshToken(admin: AdminUser): Promise<string> {
  return new SignJWT({
    sub: admin.id,
    email: admin.email,
    roles: admin.roles,
    permissions: admin.permissions,
    type: 'admin_refresh',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ADMIN_REFRESH_TOKEN_EXPIRY)
    .sign(ADMIN_JWT_SECRET)
}

// Verify admin token
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, ADMIN_JWT_SECRET)
    return payload as unknown as AdminTokenPayload
  } catch {
    return null
  }
}

// Set admin auth cookies
export async function setAdminAuthCookies(accessToken: string, refreshToken: string) {
  const cookieStore = await cookies()
  
  // Use lax for both environments to ensure cookies work in redirects
  cookieStore.set(ADMIN_ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60, // 15 minutes
  })
  
  cookieStore.set(ADMIN_REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60, // 8 hours
  })
}

// Clear admin auth cookies
export async function clearAdminAuthCookies() {
  const cookieStore = await cookies()
  cookieStore.delete(ADMIN_ACCESS_COOKIE)
  cookieStore.delete(ADMIN_REFRESH_COOKIE)
}

// Get admin from request (checks Authorization header or cookies)
export async function getAdminFromRequest(request: Request, opts: AdminLookupOptions = {}): Promise<{ admin: AdminUser | null; error?: string }> {
  try {
    // Check Authorization header first
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const admin = await getAdminFromToken(token, opts)
      if (admin) {
        return { admin }
      }
      return { admin: null, error: 'Invalid or expired token' }
    }
    
    // Fall back to cookies
    const admin = await getAdminFromCookies(opts)
    if (admin) {
      return { admin }
    }
    
    return { admin: null, error: 'Not authenticated' }
  } catch (error) {
    console.error('Admin auth error:', error)
    return { admin: null, error: 'Authentication failed' }
  }
}

/**
 * Two-step sign-in is required for every admin in production. Until an admin
 * turns it on, only "who am I", MFA setup and logout accept their token
 * (allowWithoutMfa). ADMIN_MFA_OPTIONAL=true in the environment lifts the
 * requirement in an emergency, e.g. a lost phone.
 */
export function adminMfaRequired(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.ADMIN_MFA_OPTIONAL !== 'true'
}

type AdminLookupOptions = { allowWithoutMfa?: boolean }

// Get admin from token (used with Authorization header)
export async function getAdminFromToken(token: string, opts: AdminLookupOptions = {}): Promise<AdminUser | null> {
  const payload = await verifyAdminToken(token)
  if (!payload || payload.type !== 'admin_access') return null
  
  // Fetch fresh admin data
  const adminResult = await sql`
    SELECT id, email, first_name, last_name, status, mfa_enabled
    FROM admin_users
    WHERE id = ${payload.sub} AND status = 'ACTIVE'
  `
  
  if (adminResult.length === 0) return null
  
  const admin = adminResult[0]
  if (!admin.mfa_enabled && adminMfaRequired() && !opts.allowWithoutMfa) return null
  const { roles, permissions } = await getAdminRolesAndPermissions(admin.id)
  
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    status: admin.status,
    mfaEnabled: admin.mfa_enabled,
    roles,
    permissions,
  }
}

// Get admin from cookies (legacy, kept for backwards compatibility)
export async function getAdminFromCookies(opts: AdminLookupOptions = {}): Promise<AdminUser | null> {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(ADMIN_ACCESS_COOKIE)?.value
  
  if (!accessToken) return null
  return getAdminFromToken(accessToken, opts)
}

// Get refresh token from cookies
export async function getAdminRefreshTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(ADMIN_REFRESH_COOKIE)?.value || null
}

// Login admin
export async function loginAdmin(
  email: string,
  password: string,
  ipAddress: string,
  userAgent: string,
  mfaCode?: string
): Promise<{ admin: AdminUser; accessToken: string; refreshToken: string } | { error: string } | { mfaRequired: true }> {
  // Find admin
  const adminResult = await sql`
    SELECT id, email, first_name, last_name, status, password_hash, mfa_enabled,
           failed_login_attempts, locked_until
    FROM admin_users
    WHERE email = ${email.toLowerCase()}
  `
  
  if (adminResult.length === 0) {
    return { error: 'Invalid credentials' }
  }
  
  const admin = adminResult[0]
  
  // Check if locked
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    return { error: 'Account locked. Try again later.' }
  }
  
  // Check status
  if (admin.status !== 'ACTIVE') {
    return { error: 'Account is not active' }
  }
  
  // Verify password
  const validPassword = await verifyPassword(password, admin.password_hash)
  
  if (!validPassword) {
    // Increment failed attempts
    const newAttempts = (admin.failed_login_attempts || 0) + 1
    const lockUntil = newAttempts >= 5 
      ? new Date(Date.now() + 15 * 60 * 1000) // Lock for 15 minutes
      : null
    
    await sql`
      UPDATE admin_users
      SET failed_login_attempts = ${newAttempts},
          locked_until = ${lockUntil}
      WHERE id = ${admin.id}
    `
    
    return { error: 'Invalid credentials' }
  }

  // Two-step sign-in (lib/admin-mfa.ts): once an admin has turned it on, the
  // password alone is not enough. Wrong codes count toward the same lockout.
  if (admin.mfa_enabled) {
    if (!mfaCode) return { mfaRequired: true }
    if (!(await verifyAdminMfaCode(admin.id, mfaCode))) {
      const newAttempts = (admin.failed_login_attempts || 0) + 1
      const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null
      await sql`
        UPDATE admin_users
        SET failed_login_attempts = ${newAttempts},
            locked_until = ${lockUntil}
        WHERE id = ${admin.id}
      `
      return { error: 'Invalid code' }
    }
  }
  
  // Get roles and permissions
  const { roles, permissions } = await getAdminRolesAndPermissions(admin.id)
  
  const adminUser: AdminUser = {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    status: admin.status,
    mfaEnabled: admin.mfa_enabled,
    roles,
    permissions,
  }
  
  // Generate tokens
  const accessToken = await generateAdminAccessToken(adminUser)
  const refreshToken = await generateAdminRefreshToken(adminUser)
  
  // Store session
  const tokenHash = await bcrypt.hash(refreshToken, 10)
  await sql`
    INSERT INTO admin_sessions (admin_user_id, token_hash, ip_address, user_agent, expires_at)
    VALUES (
      ${admin.id},
      ${tokenHash},
      ${ipAddress},
      ${userAgent},
      ${new Date(Date.now() + 8 * 60 * 60 * 1000)}
    )
  `
  
  // Update admin login info
  await sql`
    UPDATE admin_users
    SET last_login_at = NOW(),
        last_login_ip = ${ipAddress},
        failed_login_attempts = 0,
        locked_until = NULL
    WHERE id = ${admin.id}
  `
  
  // Log action
  await logAdminAction(admin.id, 'LOGIN', null, null, { ipAddress }, ipAddress, userAgent)
  
  return { admin: adminUser, accessToken, refreshToken }
}

// Refresh admin tokens
export async function refreshAdminTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const payload = await verifyAdminToken(refreshToken)
  if (!payload || payload.type !== 'admin_refresh') return null
  
  // The token must belong to one live session (matched by its stored hash),
  // not just to an admin who has some session: a leaked old token used to
  // keep working after logout + a new login elsewhere.
  const sessions = await sql`
    SELECT id, token_hash FROM admin_sessions
    WHERE admin_user_id = ${payload.sub}
      AND revoked_at IS NULL
      AND expires_at > NOW()
  `
  let sessionId: string | null = null
  for (const s of sessions) {
    if (s.token_hash && (await bcrypt.compare(refreshToken, s.token_hash as string))) {
      sessionId = s.id as string
      break
    }
  }
  if (!sessionId) return null
  
  // Get admin with fresh data
  const adminResult = await sql`
    SELECT id, email, first_name, last_name, status, mfa_enabled
    FROM admin_users
    WHERE id = ${payload.sub} AND status = 'ACTIVE'
  `
  
  if (adminResult.length === 0) return null
  
  const admin = adminResult[0]
  const { roles, permissions } = await getAdminRolesAndPermissions(admin.id)
  
  const adminUser: AdminUser = {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    status: admin.status,
    mfaEnabled: admin.mfa_enabled,
    roles,
    permissions,
  }
  
  const newAccessToken = await generateAdminAccessToken(adminUser)
  const newRefreshToken = await generateAdminRefreshToken(adminUser)

  // Rotate: the session now only accepts the new refresh token.
  await sql`
    UPDATE admin_sessions
    SET token_hash = ${await bcrypt.hash(newRefreshToken, 10)}, last_activity_at = NOW()
    WHERE id = ${sessionId}
  `
  
  return { accessToken: newAccessToken, refreshToken: newRefreshToken }
}

// Logout admin
/** End every session of this admin (their refresh tokens stop working). */
export async function revokeAdminSessions(adminUserId: string) {
  await sql`
    UPDATE admin_sessions
    SET revoked_at = NOW(), revoked_reason = 'logout'
    WHERE admin_user_id = ${adminUserId} AND revoked_at IS NULL
  `
}

export async function logoutAdmin(adminUserId: string) {
  await revokeAdminSessions(adminUserId)
  await clearAdminAuthCookies()
}

// Check if admin has permission
export function hasPermission(admin: AdminUser, permission: string): boolean {
  // Super admin has all permissions
  if (admin.roles.includes('SUPER_ADMIN')) return true
  return admin.permissions.includes(permission)
}

// Check if admin has any of the permissions
export function hasAnyPermission(admin: AdminUser, permissions: string[]): boolean {
  if (admin.roles.includes('SUPER_ADMIN')) return true
  return permissions.some(p => admin.permissions.includes(p))
}

// Log admin action (immutable audit trail)
export async function logAdminAction(
  adminUserId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
  ipAddress?: string,
  userAgent?: string,
  ticketId?: string
) {
  try {
    await sql`
      INSERT INTO admin_action_logs (
        admin_user_id, action, target_type, target_id, metadata, 
        ip_address, user_agent, ticket_id
      )
      VALUES (
        ${adminUserId},
        ${action},
        ${targetType},
        ${targetId}::text,
        ${JSON.stringify(metadata)},
        ${ipAddress || null},
        ${userAgent || null},
        ${ticketId || null}
      )
    `
  } catch (error) {
    // Log but don't throw - action logging shouldn't break main functionality
    console.error('Failed to log admin action:', error)
  }
}

// Create initial super admin (run once during setup)
export async function createSuperAdmin(
  email: string,
  password: string,
  firstName: string,
  lastName: string
): Promise<AdminUser | { error: string }> {
  // Check if any super admin exists
  const existingSuper = await sql`
    SELECT au.id
    FROM admin_users au
    JOIN admin_user_roles aur ON au.id = aur.admin_user_id
    JOIN admin_roles ar ON aur.role_id = ar.id
    WHERE ar.name = 'SUPER_ADMIN'
    LIMIT 1
  `
  
  if (existingSuper.length > 0) {
    return { error: 'Super admin already exists' }
  }
  
  const passwordHash = await hashPassword(password)
  
  // Create admin user
  const result = await sql`
    INSERT INTO admin_users (email, password_hash, first_name, last_name, status)
    VALUES (${email.toLowerCase()}, ${passwordHash}, ${firstName}, ${lastName}, 'ACTIVE')
    RETURNING id, email, first_name, last_name, status, mfa_enabled
  `
  
  const admin = result[0]
  
  // Assign super admin role
  await sql`
    INSERT INTO admin_user_roles (admin_user_id, role_id)
    SELECT ${admin.id}, id FROM admin_roles WHERE name = 'SUPER_ADMIN'
  `
  
  const { roles, permissions } = await getAdminRolesAndPermissions(admin.id)
  
  return {
    id: admin.id,
    email: admin.email,
    firstName: admin.first_name,
    lastName: admin.last_name,
    status: admin.status,
    mfaEnabled: admin.mfa_enabled,
    roles,
    permissions,
  }
}
