import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { getAdminFromRequest, hasPermission } from '@/lib/admin-auth'

// PATCH - Process a payment (approve or reject)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ transactionId: string }> }
) {
  try {
    const { admin, error } = await getAdminFromRequest(request)

    if (!admin) {
      return NextResponse.json({ success: false, error: error || 'Unauthorized' }, { status: 401 })
    }

    if (!hasPermission(admin, 'payments.update')) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { transactionId } = await params
    const body = await request.json()
    const { action, transactionRef, rejectionReason, gateway } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Must be "approve" or "reject"' },
        { status: 400 }
      )
    }

    // Get the transaction
    const txResult = await sql`
      SELECT pt.*, s.family_id, s.tier as current_tier
      FROM payment_transactions pt
      LEFT JOIN subscriptions s ON pt.subscription_id = s.id
      WHERE pt.id = ${transactionId}
    `

    if (txResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 }
      )
    }

    const transaction = txResult[0]

    if (transaction.status !== 'PENDING') {
      return NextResponse.json(
        { success: false, error: 'Transaction is not pending' },
        { status: 400 }
      )
    }

    if (action === 'approve') {
      if (!transactionRef) {
        return NextResponse.json(
          { success: false, error: 'Transaction reference is required for approval' },
          { status: 400 }
        )
      }

      // Get the new tier from metadata
      const newTier = transaction.metadata?.tier || 'PREMIUM'

      // Update transaction status - atomic claim: only succeeds if still PENDING,
      // so two concurrent approve clicks can't both process the same transaction.
      const approveResult = await sql`
        UPDATE payment_transactions
        SET
          status = 'COMPLETED',
          stripe_payment_id = ${transactionRef},
          metadata = metadata || ${JSON.stringify({
            processedAt: new Date().toISOString(),
            processedBy: admin.id,
            gateway: gateway || 'amex',
            amexTransactionRef: transactionRef
          })}::jsonb
        WHERE id = ${transactionId} AND status = 'PENDING'
        RETURNING id
      `

      if (approveResult.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Transaction was already processed' },
          { status: 409 }
        )
      }

      // Update subscription tier
      if (transaction.subscription_id) {
        await sql`
          UPDATE subscriptions
          SET
            tier = ${newTier}::subscription_tier,
            status = 'ACTIVE',
            updated_at = NOW()
          WHERE id = ${transaction.subscription_id}
        `

        // Log subscription status change
        await sql`
          INSERT INTO subscription_status_history (
            id, subscription_id, old_status, new_status,
            notes, source, admin_user_id, changed_at
          ) VALUES (
            gen_random_uuid(),
            ${transaction.subscription_id},
            ${transaction.current_tier || 'FREE'},
            ${newTier},
            ${'Payment approved via AMEX. Ref: ' + transactionRef},
            'admin_upgrade',
            ${admin.id}::uuid,
            NOW()
          )
        `
      }

      // Log admin action
      await sql`
        INSERT INTO admin_action_logs (
          id, admin_user_id, action, target_type, target_id, metadata, created_at
        ) VALUES (
          gen_random_uuid(),
          ${admin.id}::uuid,
          'APPROVE_PAYMENT',
          'payment_transaction',
          ${transactionId}::uuid,
          ${JSON.stringify({
            transactionRef,
            gateway: gateway || 'amex',
            amount: transaction.amount,
            tier: newTier
          })}::jsonb,
          NOW()
        )
      `

      return NextResponse.json({
        success: true,
        message: 'Payment approved and subscription activated',
        data: {
          transactionId,
          newTier,
          transactionRef
        }
      })
    } else {
      // Reject
      if (!rejectionReason) {
        return NextResponse.json(
          { success: false, error: 'Rejection reason is required' },
          { status: 400 }
        )
      }

      const rejectResult = await sql`
        UPDATE payment_transactions
        SET
          status = 'FAILED',
          metadata = metadata || ${JSON.stringify({
            rejectedAt: new Date().toISOString(),
            rejectedBy: admin.id,
            rejectionReason
          })}::jsonb
        WHERE id = ${transactionId} AND status = 'PENDING'
        RETURNING id
      `

      if (rejectResult.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Transaction was already processed' },
          { status: 409 }
        )
      }

      // Log admin action
      await sql`
        INSERT INTO admin_action_logs (
          id, admin_user_id, action, target_type, target_id, metadata, created_at
        ) VALUES (
          gen_random_uuid(),
          ${admin.id}::uuid,
          'REJECT_PAYMENT',
          'payment_transaction',
          ${transactionId}::uuid,
          ${JSON.stringify({
            rejectionReason,
            amount: transaction.amount
          })}::jsonb,
          NOW()
        )
      `

      return NextResponse.json({
        success: true,
        message: 'Payment rejected',
        data: {
          transactionId,
          rejectionReason
        }
      })
    }
  } catch (error) {
    console.error('Process payment error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process payment' },
      { status: 500 }
    )
  }
}
