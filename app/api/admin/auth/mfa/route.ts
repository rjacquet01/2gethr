import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromRequest, logAdminAction, verifyPassword } from '@/lib/admin-auth'
import { adminMfaStatus, startAdminMfa, confirmAdminMfa, disableAdminMfa } from '@/lib/admin-mfa'

// The signed-in admin's own two-step sign-in (authenticator app).
// GET: status. POST { action: 'setup' | 'enable' (code) | 'disable' (password) }.
export async function GET(request: NextRequest) {
  const { admin } = await getAdminFromRequest(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await adminMfaStatus(admin.id))
}

export async function POST(request: NextRequest) {
  const { admin } = await getAdminFromRequest(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || undefined
  const ua = request.headers.get('user-agent') || undefined

  try {
    if (body.action === 'setup') {
      const result = await startAdminMfa(admin.id, admin.email)
      if ('error' in result) return NextResponse.json(result, { status: 409 })
      return NextResponse.json(result)
    }

    if (body.action === 'enable') {
      if (typeof body.code !== 'string') return NextResponse.json({ error: 'Enter the code from your app' }, { status: 400 })
      const result = await confirmAdminMfa(admin.id, body.code)
      if ('error' in result) return NextResponse.json(result, { status: 400 })
      await logAdminAction(admin.id, 'MFA_ENABLED', null, null, {}, ip, ua)
      return NextResponse.json(result)
    }

    if (body.action === 'disable') {
      // Turning it off needs the password, so a stolen session can't.
      const rows = await sql`SELECT password_hash FROM admin_users WHERE id = ${admin.id}`
      const ok = typeof body.password === 'string' && rows[0]?.password_hash
        && (await verifyPassword(body.password, rows[0].password_hash as string))
      if (!ok) return NextResponse.json({ error: 'Wrong password' }, { status: 403 })
      await disableAdminMfa(admin.id)
      await logAdminAction(admin.id, 'MFA_DISABLED', null, null, {}, ip, ua)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Admin MFA error:', error)
    return NextResponse.json({ error: 'Something went wrong' }, { status: 500 })
  }
}
