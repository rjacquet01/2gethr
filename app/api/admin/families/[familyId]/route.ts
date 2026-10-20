import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

// Get family details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin || !hasPermission(admin, 'families.read')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { familyId } = await params
    
    // Get family
    const familyResult = await sql`
      SELECT f.*, u.email as owner_email, u.first_name as owner_first_name, u.last_name as owner_last_name
      FROM families f
      LEFT JOIN users u ON f.owner_id = u.id
      WHERE f.id = ${familyId}
    `
    
    if (familyResult.length === 0) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }
    
    const family = familyResult[0]
    
    // Get members
    const members = await sql`
      SELECT 
        fm.id, fm.role, fm.joined_at, fm.is_active,
        fm.can_create_events, fm.requires_event_approval,
        u.id as user_id, u.email, u.first_name, u.last_name
      FROM family_members fm
      JOIN users u ON fm.user_id = u.id
      WHERE fm.family_id = ${familyId}
      ORDER BY fm.joined_at
    `
    
    // Get children
    const children = await sql`
      SELECT cp.*, fm.id as member_id, fm.user_id as member_user_id
      FROM child_profiles cp
      JOIN family_members fm ON cp.family_member_id = fm.id
      WHERE fm.family_id = ${familyId}
    `
    
    // Get subscription
    const subscriptionResult = await sql`
      SELECT * FROM subscriptions WHERE family_id = ${familyId}
    `
    
    // Get subscription history
    const subscriptionHistory = await sql`
      SELECT ssh.*, au.email as admin_email
      FROM subscription_status_history ssh
      LEFT JOIN admin_users au ON ssh.admin_user_id = au.id
      WHERE ssh.subscription_id IN (
        SELECT id FROM subscriptions WHERE family_id = ${familyId}
      )
      ORDER BY ssh.changed_at DESC
      LIMIT 20
    `
    
    // Get risk flags
    const riskFlags = await sql`
      SELECT rf.*, au.email as reviewed_by_email
      FROM risk_flags rf
      LEFT JOIN admin_users au ON rf.reviewed_by_admin_id = au.id
      WHERE rf.family_id = ${familyId}
      ORDER BY rf.created_at DESC
    `
    
    // Log access
    await logAdminAction(
      admin.id,
      'VIEW_FAMILY',
      'family',
      familyId,
      {},
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    )
    
    return NextResponse.json({
      family: {
        id: family.id,
        name: family.name,
        createdAt: family.created_at,
        owner: {
          id: family.owner_id,
          email: family.owner_email,
          firstName: family.owner_first_name,
          lastName: family.owner_last_name,
        },
      },
      members: members.map(m => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        firstName: m.first_name,
        lastName: m.last_name,
        role: m.role,
        joinedAt: m.joined_at,
        isActive: m.is_active,
        canCreateEvents: m.can_create_events,
        requiresEventApproval: m.requires_event_approval,
      })),
      children: children.map(c => ({
        id: c.id,
        memberId: c.member_id,
        // Only children without their own login can be deleted from here.
        hasLogin: !!c.member_user_id,
        displayName: c.display_name,
        age: c.age,
        school: c.school,
        grade: c.grade,
      })),
      subscription: subscriptionResult[0] ? {
        id: subscriptionResult[0].id,
        tier: subscriptionResult[0].tier,
        status: subscriptionResult[0].status,
        currentPeriodStart: subscriptionResult[0].current_period_start,
        currentPeriodEnd: subscriptionResult[0].current_period_end,
        trialEndsAt: subscriptionResult[0].trial_ends_at,
        cancelAtPeriodEnd: subscriptionResult[0].cancel_at_period_end,
      } : null,
      subscriptionHistory: subscriptionHistory.map(h => ({
        id: h.id,
        oldStatus: h.old_status,
        newStatus: h.new_status,
        source: h.source,
        adminEmail: h.admin_email,
        notes: h.notes,
        changedAt: h.changed_at,
      })),
      riskFlags: riskFlags.map(f => ({
        id: f.id,
        type: f.flag_type,
        severity: f.severity,
        status: f.status,
        description: f.description,
        reviewedByEmail: f.reviewed_by_email,
        reviewedAt: f.reviewed_at,
        resolutionNotes: f.resolution_notes,
        createdAt: f.created_at,
      })),
    })
  } catch (error) {
    console.error('Admin get family error:', error)
    return NextResponse.json({ error: 'Failed to get family' }, { status: 500 })
  }
}
