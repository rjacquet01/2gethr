import { NextRequest, NextResponse } from 'next/server'
import { createSuperAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { sendAdminCreatedEmails } from '@/lib/admin-created-email'

// One-time setup endpoint for creating the first super admin
export async function POST(request: NextRequest) {
  try {
    // Check if setup is allowed (no super admin exists)
    const existing = await sql`
      SELECT au.id
      FROM admin_users au
      JOIN admin_user_roles aur ON au.id = aur.admin_user_id
      JOIN admin_roles ar ON aur.role_id = ar.id
      WHERE ar.name = 'SUPER_ADMIN'
      LIMIT 1
    `
    
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'Setup already completed' },
        { status: 403 }
      )
    }
    
    const body = await request.json()
    const { email, password, firstName, lastName } = body
    
    if (!email || !password || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'All fields required' },
        { status: 400 }
      )
    }
    
    if (password.length < 12) {
      return NextResponse.json(
        { error: 'Password must be at least 12 characters' },
        { status: 400 }
      )
    }
    
    const result = await createSuperAdmin(email, password, firstName, lastName)
    
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    
    await sendAdminCreatedEmails(
      { email: result.email, firstName: result.firstName, lastName: result.lastName, role: 'SUPER_ADMIN' },
      null
    )

    return NextResponse.json({
      message: 'Super admin created successfully',
      admin: {
        id: result.id,
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
      },
    })
  } catch (error) {
    console.error('[v0] Admin setup error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Setup failed' },
      { status: 500 }
    )
  }
}

// Check if setup is needed
export async function GET() {
  try {
    const existing = await sql`
      SELECT COUNT(*) as count
      FROM admin_users au
      JOIN admin_user_roles aur ON au.id = aur.admin_user_id
      JOIN admin_roles ar ON aur.role_id = ar.id
      WHERE ar.name = 'SUPER_ADMIN'
    `
    
    return NextResponse.json({
      setupRequired: parseInt(existing[0].count) === 0,
    })
  } catch (error) {
    console.error('Admin setup check error:', error)
    return NextResponse.json({ setupRequired: true })
  }
}
