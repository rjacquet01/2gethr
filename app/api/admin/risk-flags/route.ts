import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromToken, hasPermission } from '@/lib/admin-auth'

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission - hasPermission takes admin object and permission string.
    // Real seeded key is 'trust.read' (see scripts/003-admin-schema.sql); this
    // used to check the nonexistent 'risk_flags.read' and 403'd every TRUST_SAFETY admin.
    if (!hasPermission(admin, 'trust.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const status = searchParams.get('status') || 'unresolved'
    const severity = searchParams.get('severity') || 'all'
    const resolvedToday = searchParams.get('resolvedToday') === 'true'
    const offset = (page - 1) * limit

    // Build query based on filters - using proper SQL template literals
    let flags
    let countResult

    // Handle resolvedToday filter first
    if (resolvedToday) {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
        AND rf.reviewed_at >= CURRENT_DATE
        AND rf.reviewed_at < CURRENT_DATE + INTERVAL '1 day'
        ORDER BY rf.reviewed_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
        AND rf.reviewed_at >= CURRENT_DATE
        AND rf.reviewed_at < CURRENT_DATE + INTERVAL '1 day'
      `
    } else if (status === 'unresolved' && severity !== 'all') {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.status NOT IN ('RESOLVED', 'DISMISSED')
        AND rf.severity = ${severity}
        ORDER BY
          CASE rf.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.status NOT IN ('RESOLVED', 'DISMISSED')
        AND rf.severity = ${severity}
      `
    } else if (status === 'unresolved') {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.status NOT IN ('RESOLVED', 'DISMISSED')
        ORDER BY
          CASE rf.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.status NOT IN ('RESOLVED', 'DISMISSED')
      `
    } else if (status === 'resolved' && severity !== 'all') {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
        AND rf.severity = ${severity}
        ORDER BY rf.reviewed_at DESC NULLS LAST, rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
        AND rf.severity = ${severity}
      `
    } else if (status === 'resolved') {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
        ORDER BY rf.reviewed_at DESC NULLS LAST, rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.status IN ('RESOLVED', 'DISMISSED')
      `
    } else if (severity !== 'all') {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        WHERE rf.severity = ${severity}
        ORDER BY
          CASE rf.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
        WHERE rf.severity = ${severity}
      `
    } else {
      flags = await sql`
        SELECT
          rf.id,
          rf.family_id,
          rf.user_id,
          rf.flag_type,
          rf.severity,
          rf.description,
          rf.status,
          rf.reviewed_at,
          rf.reviewed_by_admin_id,
          rf.resolution_notes,
          rf.created_at,
          f.name as family_name,
          u.first_name,
          u.last_name,
          u.email as user_email
        FROM risk_flags rf
        LEFT JOIN families f ON rf.family_id = f.id
        LEFT JOIN users u ON rf.user_id = u.id
        ORDER BY
          CASE rf.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          rf.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
      countResult = await sql`
        SELECT COUNT(*) as total FROM risk_flags rf
      `
    }

    const total = parseInt(countResult[0]?.total || '0')

    // Transform to match frontend expected format
    const transformedFlags = flags.map(rf => ({
      id: rf.id,
      familyId: rf.family_id,
      userId: rf.user_id,
      flagType: rf.flag_type,
      severity: rf.severity,
      description: rf.description,
      isResolved: rf.status === 'RESOLVED' || rf.status === 'DISMISSED',
      resolvedAt: rf.reviewed_at,
      resolvedBy: rf.reviewed_by_admin_id,
      resolution: rf.resolution_notes,
      createdAt: rf.created_at,
      familyName: rf.family_name,
      userName: rf.first_name && rf.last_name ? `${rf.first_name} ${rf.last_name}` : null,
      userEmail: rf.user_email,
    }))

    return NextResponse.json({
      flags: transformedFlags,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Error fetching risk flags:', error)
    return NextResponse.json({ error: 'Failed to fetch risk flags' }, { status: 500 })
  }
}

// Manually raise a risk flag against a user and/or family (e.g. from an abuse
// report). Automated detections come from /api/cron/risk-scan.
const FLAG_TYPES = [
  'PAYMENT_MISMATCH', 'ABUSIVE_SIGNUP_PATTERN', 'LOCATION_ANOMALY', 'SPAM_ACTIVITY',
  'CHARGEBACK_RISK', 'SUSPICIOUS_LOGIN', 'MULTIPLE_ACCOUNTS', 'TOS_VIOLATION',
  'ABUSE_REPORT', 'PRIVACY_CONCERN',
]
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!hasPermission(admin, 'trust.update')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { userId, familyId, flagType, severity = 'MEDIUM', description } = body
    if (!userId && !familyId) {
      return NextResponse.json({ error: 'userId or familyId required' }, { status: 400 })
    }
    if (!FLAG_TYPES.includes(flagType)) {
      return NextResponse.json({ error: 'Invalid flagType' }, { status: 400 })
    }
    if (!SEVERITIES.includes(severity)) {
      return NextResponse.json({ error: 'Invalid severity' }, { status: 400 })
    }

    const rows = await sql`
      INSERT INTO risk_flags (user_id, family_id, flag_type, severity, status, description, evidence)
      VALUES (${userId || null}, ${familyId || null}, ${flagType}, ${severity}, 'OPEN',
              ${description || null}, ${JSON.stringify({ createdByAdmin: admin.id, manual: true })}::jsonb)
      RETURNING id
    `
    return NextResponse.json({ success: true, id: rows[0].id })
  } catch (error) {
    console.error('Create risk flag error:', error)
    return NextResponse.json({ error: 'Failed to create risk flag' }, { status: 500 })
  }
}
