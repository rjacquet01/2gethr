import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { stripe, getPriceId } from '@/lib/stripe'

// History is an audit nicety: a failure to write it must never fail the change.
async function safeHistory(run: () => Promise<unknown>) {
  try { await run() } catch (e) { console.error('subscription history insert failed', e) }
}

// Update subscription (change tier, grant trial, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ subscriptionId: string }> }
) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    const admin = token ? await getAdminFromToken(token) : null
    
    if (!admin || !hasPermission(admin, 'subscriptions.update')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { subscriptionId } = await params
    const body = await request.json()
    const { action, tier, trialDays, reason, ticketId } = body
    
    const ipAddress = request.headers.get('x-forwarded-for') || undefined
    const userAgent = request.headers.get('user-agent') || undefined
    
    // Get current subscription
    const current = await sql`
      SELECT * FROM subscriptions WHERE id = ${subscriptionId}
    `
    
    if (current.length === 0) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }
    
    const subscription = current[0]
    
    if (action === 'change_tier') {
      if (!tier || !['FREE', 'PREMIUM', 'PREMIUM_PLUS'].includes(tier)) {
        return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
      }
      
      // Keep Stripe in step with the admin change, otherwise the next
      // customer.subscription.updated webhook would silently revert it.
      if (subscription.stripe_subscription_id) {
        try {
          if (tier === 'FREE') {
            await stripe.subscriptions.cancel(subscription.stripe_subscription_id)
          } else {
            const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id)
            const item = stripeSub.items.data[0]
            const cycle = item?.price.recurring?.interval === 'year' ? 'annual' : 'monthly'
            const priceId = getPriceId(tier, cycle)
            if (item && priceId && item.price.id !== priceId) {
              await stripe.subscriptions.update(subscription.stripe_subscription_id, {
                items: [{ id: item.id, price: priceId }],
                proration_behavior: 'create_prorations',
              })
            }
          }
        } catch (e) {
          console.error('Stripe sync for admin tier change failed:', e)
          return NextResponse.json(
            { error: 'Stripe update failed: ' + (e instanceof Error ? e.message : 'unknown') + '. Tier not changed.' },
            { status: 502 }
          )
        }
      }

      await sql`
        UPDATE subscriptions
        SET tier = ${tier}, updated_at = NOW()
        WHERE id = ${subscriptionId}
      `
      
      // Record history
      await safeHistory(() => sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, admin_user_id, ticket_id, notes
        ) VALUES (
          gen_random_uuid(), ${subscriptionId},
          ${subscription.tier},
          ${tier},
          'ADMIN_MANUAL',
          ${admin.id}::uuid,
          ${ticketId || null}::uuid,
          ${reason || null}
        )
      `)
      
      await safeHistory(() => logAdminAction(admin.id, 'CHANGE_SUBSCRIPTION_TIER', 'subscription', subscriptionId, {
        oldTier: subscription.tier,
        newTier: tier,
        reason,
        ticketId,
      }, ipAddress, userAgent, ticketId))
      
      return NextResponse.json({ success: true, message: `Tier changed to ${tier}` })
    }
    
    if (action === 'grant_trial') {
      const days = parseInt(trialDays) || 14
      const trialEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
      
      await sql`
        UPDATE subscriptions
        SET tier = 'PREMIUM_PLUS',
            status = 'TRIALING',
            trial_ends_at = ${trialEnd},
            updated_at = NOW()
        WHERE id = ${subscriptionId}
      `
      
      await safeHistory(() => sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, admin_user_id, ticket_id, notes
        ) VALUES (
          gen_random_uuid(), ${subscriptionId},
          ${subscription.status},
          'TRIALING',
          'ADMIN_MANUAL',
          ${admin.id}::uuid,
          ${ticketId || null}::uuid,
          ${reason || `Granted ${days}-day trial`}
        )
      `)
      
      await safeHistory(() => logAdminAction(admin.id, 'GRANT_TRIAL', 'subscription', subscriptionId, {
        trialDays: days,
        trialEnd: trialEnd.toISOString(),
        reason,
        ticketId,
      }, ipAddress, userAgent, ticketId))
      
      return NextResponse.json({ success: true, message: `${days}-day trial granted` })
    }
    
    if (action === 'cancel') {
      await sql`
        UPDATE subscriptions
        SET status = 'CANCELLED',
            cancel_at_period_end = true,
            updated_at = NOW()
        WHERE id = ${subscriptionId}
      `
      
      await safeHistory(() => sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, admin_user_id, ticket_id, notes
        ) VALUES (
          gen_random_uuid(), ${subscriptionId},
          ${subscription.status},
          'CANCELLED',
          'ADMIN_MANUAL',
          ${admin.id}::uuid,
          ${ticketId || null}::uuid,
          ${reason || null}
        )
      `)
      
      await safeHistory(() => logAdminAction(admin.id, 'CANCEL_SUBSCRIPTION', 'subscription', subscriptionId, {
        reason,
        ticketId,
      }, ipAddress, userAgent, ticketId))
      
      return NextResponse.json({ success: true, message: 'Subscription cancelled' })
    }
    
    if (action === 'reactivate') {
      await sql`
        UPDATE subscriptions
        SET status = 'ACTIVE',
            cancel_at_period_end = false,
            updated_at = NOW()
        WHERE id = ${subscriptionId}
      `
      
      await safeHistory(() => sql`
        INSERT INTO subscription_status_history (
          id, subscription_id, old_status, new_status, source, admin_user_id, ticket_id, notes
        ) VALUES (
          gen_random_uuid(), ${subscriptionId},
          ${subscription.status},
          'ACTIVE',
          'ADMIN_MANUAL',
          ${admin.id}::uuid,
          ${ticketId || null}::uuid,
          ${reason || null}
        )
      `)
      
      await safeHistory(() => logAdminAction(admin.id, 'REACTIVATE_SUBSCRIPTION', 'subscription', subscriptionId, {
        reason,
        ticketId,
      }, ipAddress, userAgent, ticketId))
      
      return NextResponse.json({ success: true, message: 'Subscription reactivated' })
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Admin update subscription error:', error)
    return NextResponse.json({ error: 'Failed to update subscription: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 500 })
  }
}
