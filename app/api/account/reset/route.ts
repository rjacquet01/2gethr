import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { neon } from '@neondatabase/serverless'
import type { Row } from '@/lib/db'
import { verifyAccessToken, getUserById } from '@/lib/auth'

const sql = neon(process.env.DATABASE_URL!)

export async function POST(request: Request) {
  try {
    // BUG FIX: verifyAccessToken() expects a JWT string, not the Request object.
    // The previous code (`verifyAccessToken(request)`) always threw, so this
    // endpoint always returned 500 and the "reset my data" feature never worked.
    const authHeader = request.headers.get('Authorization')
    let accessToken: string | undefined

    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7)
    }

    if (!accessToken) {
      const cookieStore = await cookies()
      accessToken = cookieStore.get('access_token')?.value
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(accessToken)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getUserById(payload.userId)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { confirmEmail } = body

    // Verify confirmation
    if (confirmEmail !== user.email) {
      return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 })
    }

    // Get user's family memberships
    const memberships = (await sql`
      SELECT family_id FROM family_members WHERE user_id = ${user.id}
    `) as Row<{ family_id: string }>[]
    const familyIds = memberships.map((m: { family_id: string }) => m.family_id)

    // Delete user data in order (respecting foreign keys)
    // Note: We keep the user account but delete associated data
    
    // Delete favorites
    await sql`DELETE FROM user_favorites WHERE user_id = ${user.id}`
    
    // Delete notifications
    await sql`DELETE FROM notifications WHERE user_id = ${user.id}`
    
    // Delete location data
    await sql`DELETE FROM location_pings WHERE user_id = ${user.id}`
    await sql`DELETE FROM geofence_events WHERE user_id = ${user.id}`
    
    // Delete location settings for user's memberships
    if (familyIds.length > 0) {
      await sql`
        DELETE FROM location_settings 
        WHERE family_member_id IN (
          SELECT id FROM family_members WHERE user_id = ${user.id}
        )
      `
    }
    
    // Delete task comments by user
    await sql`DELETE FROM task_comments WHERE user_id = ${user.id}`
    
    // Delete task history by user
    await sql`DELETE FROM task_history WHERE user_id = ${user.id}`
    
    // Unassign tasks (don't delete, just remove assignment)
    await sql`UPDATE tasks SET assigned_to_id = NULL WHERE assigned_to_id = ${user.id}`
    
    // Delete events created by user (or could keep them with null creator)
    await sql`
      DELETE FROM event_participants 
      WHERE event_id IN (SELECT id FROM events WHERE created_by_id = ${user.id})
    `
    await sql`DELETE FROM events WHERE created_by_id = ${user.id}`
    
    // Delete event participations
    await sql`DELETE FROM event_participants WHERE user_id = ${user.id}`
    
    // Delete reminder settings
    await sql`DELETE FROM reminder_settings WHERE user_id = ${user.id}`
    
    // Delete consents
    await sql`DELETE FROM consents WHERE user_id = ${user.id}`
    
    // Remove from families (but don't delete families - they may have other members)
    await sql`DELETE FROM family_members WHERE user_id = ${user.id}`
    
    // Reset user profile (keep account but clear personal info)
    await sql`
      UPDATE users 
      SET 
        first_name = 'User',
        last_name = '',
        phone = NULL,
        date_of_birth = NULL,
        profile_photo_url = NULL,
        profile_photo_path = NULL,
        timezone = 'America/New_York',
        updated_at = NOW()
      WHERE id = ${user.id}
    `

    return NextResponse.json({ 
      success: true, 
      message: 'Account data has been reset. You can now set up your profile again.' 
    })
  } catch (error) {
    console.error('Account reset error:', error)
    return NextResponse.json({ error: 'Failed to reset account' }, { status: 500 })
  }
}
