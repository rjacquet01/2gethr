import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromRequest, hasPermission } from '@/lib/admin-auth'

// GET - List all payment transactions with user info
export async function GET(request: NextRequest) {
  try {
    const { admin, error } = await getAdminFromRequest(request)

    if (!admin) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 })
    }

    if (!hasPermission(admin, 'payments.read')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    let transactions
    if (status) {
      transactions = await sql`
        SELECT
          pt.*,
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          f.id as family_id,
          f.name as family_name
        FROM payment_transactions pt
        LEFT JOIN subscriptions s ON pt.subscription_id = s.id
        LEFT JOIN families f ON s.family_id = f.id
        LEFT JOIN users u ON f.owner_id = u.id
        WHERE pt.status = ${status}::payment_status
        ORDER BY pt.created_at DESC
      `
    } else {
      transactions = await sql`
        SELECT
          pt.*,
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name,
          f.id as family_id,
          f.name as family_name
        FROM payment_transactions pt
        LEFT JOIN subscriptions s ON pt.subscription_id = s.id
        LEFT JOIN families f ON s.family_id = f.id
        LEFT JOIN users u ON f.owner_id = u.id
        ORDER BY pt.created_at DESC
      `
    }

    // Format with nested objects
    const formattedTransactions = transactions.map(t => ({
      id: t.id,
      subscription_id: t.subscription_id,
      amount: t.amount,
      currency: t.currency || 'USD',
      status: t.status,
      description: t.description,
      stripe_payment_id: t.stripe_payment_id,
      metadata: t.metadata || {},
      created_at: t.created_at,
      user: t.user_id ? {
        id: t.user_id,
        email: t.user_email,
        first_name: t.user_first_name,
        last_name: t.user_last_name
      } : null,
      family: t.family_id ? {
        id: t.family_id,
        name: t.family_name
      } : null
    }))

    return NextResponse.json({
      success: true,
      data: formattedTransactions
    })
  } catch (error) {
    console.error('Get payment transactions error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get payment transactions' },
      { status: 500 }
    )
  }
}
