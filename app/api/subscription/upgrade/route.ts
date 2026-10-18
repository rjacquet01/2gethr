import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

// DEPRECATED: this endpoint used to accept raw card number/CVV from the
// client, base64-"encode" it, and store it for manual admin processing.
// That was never PCI compliant (base64 is not encryption) and real card
// data should never reach our server at all.
//
// The upgrade page now calls POST /api/subscription/checkout instead,
// which creates a Stripe Checkout Session — card data goes straight from
// the browser to Stripe. This route is kept only so any stale cached
// client (an old service worker, an old mobile build) gets a clear error
// instead of silently submitting card data into our database.
export async function POST(request: NextRequest) {
  return NextResponse.json(
    {
      error:
        'This endpoint has been retired. Please refresh the app and use the updated upgrade flow.',
    },
    { status: 410 }
  )
}

// GET - Get pending upgrade requests for the user (still used by the
// subscription page to show historical/pending admin-processed requests
// from before the Stripe migration).
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const familyId = searchParams.get('familyId')

    if (!familyId) {
      return NextResponse.json({ error: 'familyId required' }, { status: 400 })
    }

    // Only that family's parents/guardians see its pending upgrade requests.
    const member = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
      LIMIT 1
    `
    if (member.length === 0 || !['PARENT', 'GUARDIAN'].includes(member[0].role)) {
      return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
    }

    const transactions = await sql`
      SELECT pt.*, s.tier as current_tier
      FROM payment_transactions pt
      JOIN subscriptions s ON s.id = pt.subscription_id
      WHERE s.family_id = ${familyId} AND pt.status = 'PENDING'
      ORDER BY pt.created_at DESC
    `

    return NextResponse.json({ data: transactions })
  } catch (error) {
    console.error('Get upgrade requests error:', error)
    return NextResponse.json({ error: 'Failed to get upgrade requests' }, { status: 500 })
  }
}
