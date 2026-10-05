import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hashPassword, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

// List all admin users (SUPER_ADMIN only)
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if super admin
    if (!admin.roles.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Only super admins can manage other admins' }, { status: 403 })
    }

    const admins = await sql`
      SELECT
        au.id, au.email, au.first_name, au.last_name, au.status,
        au.created_at, au.last_login_at,
        COALESCE(
          json_agg(
            json_build_object('name', ar.name)
          ) FILTER (WHERE ar.name IS NOT NULL),
          '[]'
        ) as roles
      FROM admin_users au
      LEFT JOIN admin_user_roles aur ON au.id = aur.admin_user_id
      LEFT JOIN admin_roles ar ON aur.role_id = ar.id
      GROUP BY au.id
      ORDER BY au.created_at DESC
    `

    return NextResponse.json({
      admins: admins.map(a => ({
        id: a.id,
        email: a.email,
        firstName: a.first_name,
        lastName: a.last_name,
        status: a.status,
        roles: a.roles,
        createdAt: a.created_at,
        lastLoginAt: a.last_login_at,
      }))
    })
  } catch (error) {
    console.error('List admins error:', error)
    return NextResponse.json({ error: 'Failed to fetch admins' }, { status: 500 })
  }
}

// Create new admin (SUPER_ADMIN only)
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if super admin
    if (!admin.roles.includes('SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Only super admins can create new admins' }, { status: 403 })
    }

    const { email, firstName, lastName, password, role } = await request.json()

    if (!email || !firstName || !lastName || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Check if email already exists
    const existing = await sql`SELECT id FROM admin_users WHERE email = ${email}`
    if (existing.length > 0) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 400 })
    }

    // Hash password - use the shared hashPassword() from lib/admin-auth.ts
    // (bcrypt cost 12) instead of a local bcrypt.hash(password, 10) call, so
    // every admin password in the system is hashed at the same, stronger
    // cost factor rather than drifting per call site.
    const passwordHash = await hashPassword(password)

    // Create admin user
    const newAdmin = await sql`
      INSERT INTO admin_users (email, password_hash, first_name, last_name, status)
      VALUES (${email}, ${passwordHash}, ${firstName}, ${lastName}, 'ACTIVE')
      RETURNING id
    `

    // Get role ID
    const roleResult = await sql`SELECT id FROM admin_roles WHERE name = ${role}`
    if (roleResult.length > 0) {
      await sql`
        INSERT INTO admin_user_roles (admin_user_id, role_id, granted_at)
        VALUES (${newAdmin[0].id}, ${roleResult[0].id}, NOW())
      `
    }

    // Log the action
    const ipAddress = request.headers.get('x-forwarded-for') || 'unknown'
    await logAdminAction(admin.id, 'CREATE_ADMIN', 'admin_user', newAdmin[0].id, { email, role }, ipAddress)

    return NextResponse.json({ success: true, adminId: newAdmin[0].id })
  } catch (error) {
    console.error('Create admin error:', error)
    return NextResponse.json({ error: 'Failed to create admin' }, { status: 500 })
  }
}
