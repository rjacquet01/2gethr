import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

// PATCH - Process an upgrade request (approve/reject)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null

    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!hasPermission(admin, 'subscriptions.update')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { transactionId } = await params
    const body = await request.json()
    const { action, stripePaymentId, notes } = body

    // Get the transaction
    const transaction = await sql`
      SELECT pt.*, s.family_id, s.tier as current_tier
      FROM payment_transactions pt
      JOIN subscriptions s ON s.id = pt.subscription_id
      WHERE pt.id = ${transactionId}
    `

    if (transaction.length === 0) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (transaction[0].status !== 'PENDING') {
      return NextResponse.json({ error: 'Transaction already processed' }, { status: 400 })
    }

    const metadata = transaction[0].metadata as { requestedTier?: string; billingCycle?: string }

    if (action === 'approve') {
      // Update transaction to succeeded - atomic claim: only succeeds if still
      // PENDING, so two concurrent approve clicks can't both process this.
      const approveResult = await sql`
        UPDATE payment_transactions
        SET status = 'SUCCEEDED',
            stripe_payment_id = ${stripePaymentId || null},
            metadata = metadata || ${JSON.stringify({
              processedBy: admin.id,
              processedAt: new Date().toISOString(),
              notes: notes || null
            })}::jsonb
        WHERE id = ${transactionId} AND status = 'PENDING'
        RETURNING id
      `

      if (approveResult.length === 0) {
        return NextResponse.json({ error: 'Transaction was already processed' }, { status: 409 })
      }

      // Update subscription tier
      const newTier = metadata?.requestedTier || 'PREMIUM'
      const billingCycle = metadata?.billingCycle || 'monthly'

      // Calculate period end date
      const periodEnd = new Date()
      if (billingCycle === 'annual') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1)
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1)
      }

      await sql`
        UPDATE subscriptions
        SET tier = ${newTier},
            status = 'ACTIVE',
            current_period_start = NOW(),
            current_period_end = ${periodEnd.toISOString()},
            updated_at = NOW()
        WHERE id = ${transaction[0].subscription_id}
      `

      // Log subscription status change
      await sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, notes, changed_at, admin_user_id
        ) VALUES (
          gen_random_uuid(), ${transaction[0].subscription_id},
          ${transaction[0].current_tier}, ${newTier},
          'ADMIN_APPROVAL', ${notes || 'Payment approved by admin'}, NOW(), ${admin.id}::uuid
        )
      `

      // Log admin action
      await logAdminAction(
        admin.id,
        'subscription_upgrade_approved',
        'subscription',
        transaction[0].subscription_id,
        {
          transactionId,
          newTier,
          amount: transaction[0].amount,
          familyId: transaction[0].family_id
        },
        request.headers.get('x-forwarded-for') || 'unknown',
        request.headers.get('user-agent') || 'unknown'
      )

      return NextResponse.json({
        success: true,
        message: 'Upgrade approved and subscription activated',
        newTier
      })
    }

    if (action === 'reject') {
      // Update transaction to failed - same atomic-claim guard as approve.
      const rejectResult = await sql`
        UPDATE payment_transactions
        SET status = 'FAILED',
            metadata = metadata || ${JSON.stringify({
              rejectedBy: admin.id,
              rejectedAt: new Date().toISOString(),
              notes: notes || 'Rejected by admin'
            })}::jsonb
        WHERE id = ${transactionId} AND status = 'PENDING'
        RETURNING id
      `

      if (rejectResult.length === 0) {
        return NextResponse.json({ error: 'Transaction was already processed' }, { status: 409 })
      }

      // Log subscription status change
      await sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, notes, changed_at, admin_user_id
        ) VALUES (
          gen_random_uuid(), ${transaction[0].subscription_id},
          'PENDING_UPGRADE', ${transaction[0].current_tier},
          'ADMIN_REJECTION', ${notes || 'Upgrade request rejected'}, NOW(), ${admin.id}::uuid
        )
      `

      // Log admin action
      await logAdminAction(
        admin.id,
        'subscription_upgrade_rejected',
        'subscription',
        transaction[0].subscription_id,
        { transactionId, familyId: transaction[0].family_id },
        request.headers.get('x-forwarded-for') || 'unknown',
        request.headers.get('user-agent') || 'unknown'
      )

      return NextResponse.json({ success: true, message: 'Upgrade request rejected' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Admin upgrade PATCH error:', error)
    return NextResponse.json({ error: 'Failed to process upgrade request' }, { status: 500 })
  }
}
