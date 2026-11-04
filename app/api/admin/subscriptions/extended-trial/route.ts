import { NextRequest, NextResponse } from 'next/server'
import { getAdminFromToken, hasPermission, logAdminAction, type AdminUser } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { logAuditEvent } from '@/lib/auth'
import { getTierDefinition } from '@/lib/subscription-tiers'
import { trialBlockedByStripe } from '@/lib/trial-eligibility'
import { familyOwnerAccount, notifyAccountChange, requestIp } from '@/lib/admin-account-alerts'
import {
  EXTENDED_TRIAL_SOURCE,
  decideGrant,
  ensureTrialSourceColumn,
  isActiveExtendedTrial,
  parseExtendedTrialInput,
  type TrialRow,
} from '@/lib/extended-trial'

// Admin extended trials (lib/extended-trial.ts). POST grants or replaces one,
// DELETE ends it now. Nothing here talks to Stripe: no customer, subscription,
// invoice or charge is created, and a family Stripe is billing is refused.

// Audit extras: a failure to write them must never fail the change.
async function safeLog(run: () => Promise<unknown>) {
  try { await run() } catch (e) { console.error('extended trial audit write failed', e) }
}

async function adminFrom(request: NextRequest): Promise<AdminUser | null> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const admin = token ? await getAdminFromToken(token) : null
  return admin && hasPermission(admin, 'subscriptions.update') ? admin : null
}

async function loadFamily(familyId: string) {
  const families = await sql`SELECT id, name FROM families WHERE id = ${familyId}`
  if (families.length === 0) return null
  await ensureTrialSourceColumn()
  const subs = await sql`
    SELECT id, tier, status, trial_ends_at, stripe_subscription_id, trial_source
    FROM subscriptions
    WHERE family_id = ${familyId}
    ORDER BY created_at DESC
    LIMIT 1
  `
  return { name: String(families[0].name), sub: (subs[0] as (TrialRow & { id: string }) | undefined) ?? null }
}

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

// Grant (or replace) an extended trial.
export async function POST(request: NextRequest) {
  try {
    const admin = await adminFrom(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = parseExtendedTrialInput(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { familyId, tier, days, note, replace } = parsed.input

    const family = await loadFamily(familyId)
    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }
    const current = family.sub

    const decision = decideGrant(current, { days, replace })
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error, code: decision.code }, { status: decision.status })
    }
    const endsAt = decision.endsAt
    const plan = getTierDefinition(tier).name

    // Stored like any trial. A cancelled Stripe subscription id is cleared so
    // the daily expiry ends this trial and the page doesn't show it as billed.
    let subscriptionId: string
    if (current) {
      const updated = await sql`
        UPDATE subscriptions SET
          tier = ${tier},
          status = 'TRIALING',
          trial_ends_at = ${endsAt.toISOString()},
          current_period_start = NOW(),
          current_period_end = ${endsAt.toISOString()},
          cancel_at_period_end = false,
          stripe_subscription_id = NULL,
          trial_source = ${EXTENDED_TRIAL_SOURCE},
          updated_at = NOW()
        WHERE id = ${current.id}
          AND (stripe_subscription_id IS NULL OR status = 'CANCELLED')
        RETURNING id
      `
      // Stripe attached a subscription since we looked.
      if (updated.length === 0) {
        return NextResponse.json({ error: 'This family has a Stripe subscription now. No trial was granted.', code: 'PAYING' }, { status: 409 })
      }
      subscriptionId = current.id
    } else {
      subscriptionId = crypto.randomUUID()
      await sql`
        INSERT INTO subscriptions (
          id, family_id, tier, status, trial_ends_at,
          current_period_start, current_period_end, trial_source, created_at, updated_at
        )
        VALUES (
          ${subscriptionId}, ${familyId}, ${tier}, 'TRIALING', ${endsAt.toISOString()},
          NOW(), ${endsAt.toISOString()}, ${EXTENDED_TRIAL_SOURCE}, NOW(), NOW()
        )
      `
    }

    const replaced = decision.kind === 'replace'
    const previous = current && current.status === 'TRIALING' && current.trial_ends_at
      ? `${getTierDefinition(current.tier).name} trial until ${day(current.trial_ends_at)}`
      : null
    const details = { plan, days, trialEnds: day(endsAt), ...(note ? { note } : {}) }

    await safeLog(() => sql`
      INSERT INTO subscription_status_history (
        id, subscription_id, old_status, new_status, source, admin_user_id, notes
      ) VALUES (
        gen_random_uuid(), ${subscriptionId}, ${current?.status ?? 'NONE'}, 'TRIALING',
        'ADMIN_MANUAL', ${admin.id}::uuid,
        ${`Extended ${days}-day ${plan} trial${note ? `: ${note}` : ''}`}
      )
    `)
    await safeLog(() => logAdminAction(admin.id, replaced ? 'REPLACE_EXTENDED_TRIAL' : 'GRANT_EXTENDED_TRIAL', 'subscription', subscriptionId, {
      familyId, tier, ...details, previous,
    }, requestIp(request) || undefined, request.headers.get('user-agent') || undefined))
    await safeLog(() => logAuditEvent(null, 'UPDATE', 'subscription_trial', familyId, {
      oldValue: current ? { tier: current.tier, status: current.status, trialEndsAt: current.trial_ends_at ? day(current.trial_ends_at) : null } : undefined,
      newValue: { tier, status: 'TRIALING', trialEndsAt: endsAt.toISOString() },
      metadata: { source: EXTENDED_TRIAL_SOURCE, adminId: admin.id, days, note },
      ipAddress: requestIp(request) || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    }))

    const owner = await familyOwnerAccount(familyId)
    if (owner) {
      await notifyAccountChange({
        actor: admin.email,
        actorType: 'admin',
        accountEmail: owner.accountEmail,
        familyName: owner.familyName,
        change: replaced ? 'Extended trial replaced by admin' : 'Extended trial granted by admin',
        details: replaced && previous ? { ...details, previous } : details,
        ipAddress: requestIp(request),
      })
    }

    return NextResponse.json({
      success: true,
      kind: decision.kind,
      tier,
      trialEndsAt: endsAt.toISOString(),
      message: `${family.name} has ${plan} free until ${day(endsAt)}.`,
    })
  } catch (error) {
    console.error('Admin extended trial error:', error)
    return NextResponse.json({ error: 'Failed to grant extended trial' }, { status: 500 })
  }
}

// End an extended trial now: the family goes back to Free.
export async function DELETE(request: NextRequest) {
  try {
    const admin = await adminFrom(request)
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as { familyId?: unknown; note?: unknown } | null
    const familyId = typeof body?.familyId === 'string' ? body.familyId.trim() : ''
    if (!familyId) {
      return NextResponse.json({ error: 'familyId is required' }, { status: 400 })
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : ''

    const family = await loadFamily(familyId)
    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }
    const current = family.sub
    if (current && trialBlockedByStripe(current)) {
      return NextResponse.json({ error: 'This family has a Stripe subscription. Nothing was changed.', code: 'PAYING' }, { status: 409 })
    }
    if (!current || !isActiveExtendedTrial(current)) {
      return NextResponse.json({ error: 'This family has no active extended trial.', code: 'NO_EXTENDED_TRIAL' }, { status: 409 })
    }

    const updated = await sql`
      UPDATE subscriptions SET
        tier = 'FREE',
        status = 'ACTIVE',
        trial_ends_at = NOW(),
        current_period_end = NOW(),
        cancel_at_period_end = false,
        trial_source = NULL,
        updated_at = NOW()
      WHERE id = ${current.id}
        AND status = 'TRIALING'
        AND stripe_subscription_id IS NULL
        AND trial_source = ${EXTENDED_TRIAL_SOURCE}
      RETURNING id
    `
    if (updated.length === 0) {
      return NextResponse.json({ error: 'The trial changed while you were looking. Reload and try again.', code: 'NO_EXTENDED_TRIAL' }, { status: 409 })
    }

    const plan = getTierDefinition(current.tier).name
    const details = {
      plan: { from: plan, to: 'Free' },
      trialWasUntil: current.trial_ends_at ? day(current.trial_ends_at) : null,
      ...(note ? { note } : {}),
    }

    await safeLog(() => sql`
      INSERT INTO subscription_status_history (
        id, subscription_id, old_status, new_status, source, admin_user_id, notes
      ) VALUES (
        gen_random_uuid(), ${current.id}, 'TRIALING', 'ACTIVE',
        'ADMIN_MANUAL', ${admin.id}::uuid,
        ${`Extended ${plan} trial cancelled, back to Free${note ? `: ${note}` : ''}`}
      )
    `)
    await safeLog(() => logAdminAction(admin.id, 'REVOKE_EXTENDED_TRIAL', 'subscription', current.id, {
      familyId, tier: current.tier, trialWasUntil: details.trialWasUntil, note: note || null,
    }, requestIp(request) || undefined, request.headers.get('user-agent') || undefined))
    await safeLog(() => logAuditEvent(null, 'UPDATE', 'subscription_trial', familyId, {
      oldValue: { tier: current.tier, status: 'TRIALING', trialEndsAt: details.trialWasUntil },
      newValue: { tier: 'FREE', status: 'ACTIVE' },
      metadata: { source: EXTENDED_TRIAL_SOURCE, adminId: admin.id, revoked: true, note: note || null },
      ipAddress: requestIp(request) || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    }))

    const owner = await familyOwnerAccount(familyId)
    if (owner) {
      await notifyAccountChange({
        actor: admin.email,
        actorType: 'admin',
        accountEmail: owner.accountEmail,
        familyName: owner.familyName,
        change: 'Extended trial cancelled by admin',
        details,
        ipAddress: requestIp(request),
      })
    }

    return NextResponse.json({ success: true, message: `${family.name} is back on Free.` })
  } catch (error) {
    console.error('Admin revoke extended trial error:', error)
    return NextResponse.json({ error: 'Failed to cancel extended trial' }, { status: 500 })
  }
}
