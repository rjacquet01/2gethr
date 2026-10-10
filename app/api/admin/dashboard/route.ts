import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

// Get dashboard stats and metrics
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    // User stats
    const userStats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_active = true) as active,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month
      FROM users
      WHERE email NOT LIKE 'deleted-%@deleted.togethrapp.com'
    `
    
    // Family stats
    const familyStats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week
      FROM families
    `
    
    // Subscription stats
    const subscriptionStats = await sql`
      SELECT 
        tier,
        COUNT(*) as count
      FROM subscriptions
      WHERE status = 'ACTIVE'
      GROUP BY tier
    `
    
    const subscriptionTotals = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE') as active,
        COUNT(*) FILTER (WHERE status = 'TRIALING') as trialing,
        COUNT(*) FILTER (WHERE status = 'PAST_DUE') as past_due,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled
      FROM subscriptions
    `
    
    // Support ticket stats
    const ticketStats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'OPEN') as open,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as in_progress,
        COUNT(*) FILTER (WHERE status = 'WAITING_USER') as waiting_user,
        COUNT(*) FILTER (WHERE status = 'ESCALATED') as escalated,
        COUNT(*) FILTER (WHERE priority = 'URGENT' AND status NOT IN ('RESOLVED', 'CLOSED')) as urgent,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_today
      FROM support_tickets
    `
    
    // Risk flags stats
    const riskStats = await sql`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'OPEN') as open,
        COUNT(*) FILTER (WHERE status = 'INVESTIGATING') as investigating,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND status NOT IN ('RESOLVED', 'DISMISSED')) as critical
      FROM risk_flags
    `
    
    // Closed accounts (self-service deletion anonymises the email)
    const closedStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '7 days') as last_7d,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '30 days') as last_30d,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400)), 0) as avg_tenure_days,
        COUNT(*) FILTER (WHERE updated_at - created_at < INTERVAL '7 days') as within_first_week
      FROM users
      WHERE email LIKE 'deleted-%@deleted.togethrapp.com'
    `

    // Recent activity (last 10 admin actions)
    const recentActivity = await sql`
      SELECT 
        al.action,
        al.target_type,
        al.created_at,
        au.email as admin_email,
        au.first_name as admin_name
      FROM admin_action_logs al
      JOIN admin_users au ON al.admin_user_id = au.id
      ORDER BY al.created_at DESC
      LIMIT 10
    `
    
    return NextResponse.json({
      users: {
        total: parseInt(userStats[0].total),
        active: parseInt(userStats[0].active),
        newThisWeek: parseInt(userStats[0].new_this_week),
        newThisMonth: parseInt(userStats[0].new_this_month),
      },
      families: {
        total: parseInt(familyStats[0].total),
        newThisWeek: parseInt(familyStats[0].new_this_week),
      },
      subscriptions: {
        total: parseInt(subscriptionTotals[0].total),
        active: parseInt(subscriptionTotals[0].active),
        trialing: parseInt(subscriptionTotals[0].trialing),
        pastDue: parseInt(subscriptionTotals[0].past_due),
        cancelled: parseInt(subscriptionTotals[0].cancelled),
        byTier: subscriptionStats.reduce((acc, s) => {
          acc[s.tier] = parseInt(s.count)
          return acc
        }, {} as Record<string, number>),
      },
      tickets: {
        total: parseInt(ticketStats[0].total),
        open: parseInt(ticketStats[0].open),
        inProgress: parseInt(ticketStats[0].in_progress),
        waitingUser: parseInt(ticketStats[0].waiting_user),
        escalated: parseInt(ticketStats[0].escalated),
        urgent: parseInt(ticketStats[0].urgent),
        newToday: parseInt(ticketStats[0].new_today),
      },
      riskFlags: {
        open: parseInt(riskStats[0].open),
        investigating: parseInt(riskStats[0].investigating),
        critical: parseInt(riskStats[0].critical),
      },
      closedAccounts: {
        total: parseInt(closedStats[0].total),
        last7d: parseInt(closedStats[0].last_7d),
        last30d: parseInt(closedStats[0].last_30d),
        avgTenureDays: parseInt(closedStats[0].avg_tenure_days),
        withinFirstWeek: parseInt(closedStats[0].within_first_week),
      },
      recentActivity: recentActivity.map(a => ({
        action: a.action,
        targetType: a.target_type,
        adminEmail: a.admin_email,
        adminName: a.admin_name,
        createdAt: a.created_at,
      })),
    })
  } catch (error) {
    console.error('Admin dashboard error:', error)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}
