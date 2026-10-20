import type Stripe from "stripe"
import { sql } from "./db"
import { stripe } from "./stripe"
import { notifyAdmin } from "./services/email"

// Disputes and refunds from the Stripe webhook. None of these change a
// family's tier or status: a dispute or refund doesn't by itself end a plan,
// and downgrading is the owner's (admin's) decision. They record what
// happened and tell the admin. Every handler is safe to run twice for the
// same event (Stripe redelivers).

/** Swappable in tests (scripts/test-stripe-webhook-events.ts); production uses the real ones. */
export const disputeDeps = {
  sql: sql as unknown as (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, any>[]>,
  notifyAdmin,
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

const money = (amount: number, currency: string) => `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id ?? null)

function dashboardUrl(kind: "disputes" | "payments", id: string, livemode: boolean) {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}${kind}/${id}`
}

interface FamilyRow {
  subscriptionId: string
  status: string
  familyName: string
  ownerEmail: string
}

/** The family paying through this Stripe customer, or null (then the event is ignored). */
async function familyForCustomer(customerId: string | null): Promise<FamilyRow | null> {
  if (!customerId) return null
  const rows = await disputeDeps.sql`
    SELECT s.id AS subscription_id, s.status, f.name AS family_name, u.email AS owner_email
    FROM subscriptions s
    JOIN families f ON f.id = s.family_id
    LEFT JOIN users u ON u.id = f.owner_id
    WHERE s.stripe_customer_id = ${customerId}
    LIMIT 1
  `
  if (rows.length === 0) return null
  return {
    subscriptionId: rows[0].subscription_id,
    status: rows[0].status,
    familyName: rows[0].family_name ?? "(unnamed family)",
    ownerEmail: rows[0].owner_email ?? "(unknown)",
  }
}

/** A dispute only names its charge; the charge names the customer and payment. */
async function chargeForDispute(dispute: Stripe.Dispute): Promise<Stripe.Charge | null> {
  if (typeof dispute.charge !== "string") return dispute.charge
  try {
    return await stripe.charges.retrieve(dispute.charge)
  } catch (err) {
    console.error("[stripe-disputes] could not load charge for dispute", dispute.id, (err as Error)?.message)
    return null
  }
}

/**
 * payment_transactions rows are keyed by invoice id (invoice.paid). In this
 * API version a charge reaches its invoice through the invoice payment.
 */
async function invoiceIdForPaymentIntent(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null
  try {
    const list = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: paymentIntentId }, limit: 1 })
    return idOf(list.data[0]?.invoice as string | { id: string } | undefined)
  } catch (err) {
    console.error("[stripe-disputes] invoice lookup failed", (err as Error)?.message)
    return null
  }
}

/** Insert a history row once per note (the note carries the dispute id). No tier/status change. */
async function recordHistoryOnce(f: FamilyRow, note: string): Promise<boolean> {
  const seen = await disputeDeps.sql`
    SELECT 1 FROM subscription_status_history WHERE subscription_id = ${f.subscriptionId} AND notes = ${note} LIMIT 1
  `
  if (seen.length > 0) return false
  await disputeDeps.sql`
    INSERT INTO subscription_status_history (id, subscription_id, old_status, new_status, source, notes, changed_at)
    VALUES (gen_random_uuid(), ${f.subscriptionId}, ${f.status}, ${f.status}, 'WEBHOOK', ${note}, NOW())
  `
  return true
}

function adminEmail(title: string, color: string, rows: [string, string][], footer: string, link: string) {
  const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px;">
        <h2 style="color: ${color};">${esc(title)}</h2>
        ${rows.map(([k, v]) => `<p><strong>${esc(k)}:</strong> ${esc(v)}</p>`).join("\n        ")}
        ${footer ? `<p>${esc(footer)}</p>` : ""}
        <p><a href="${esc(link)}">Open in the Stripe Dashboard</a></p>
      </div>
    `
  const text = [title, ...rows.map(([k, v]) => `${k}: ${v}`), footer, link].filter(Boolean).join("\n")
  return { html, text }
}

export async function handleDisputeCreated(dispute: Stripe.Dispute, livemode: boolean): Promise<void> {
  const charge = await chargeForDispute(dispute)
  const family = await familyForCustomer(idOf(charge?.customer as string | { id: string } | null))
  if (!family) return
  if (!(await recordHistoryOnce(family, `Dispute opened ${dispute.id}`))) return

  const dueBy = dispute.evidence_details?.due_by
  const { html, text } = adminEmail(
    "Payment disputed",
    "#ef4444",
    [
      ["Family", family.familyName],
      ["Owner email", family.ownerEmail],
      ["Amount", money(dispute.amount, dispute.currency)],
      ["Reason", dispute.reason],
      ["Dispute", dispute.id],
      ["Evidence due by", dueBy ? new Date(dueBy * 1000).toISOString() : "not given"],
    ],
    "Stripe requires evidence by the due date or the dispute is lost. The family's plan has not been changed.",
    dashboardUrl("disputes", dispute.id, livemode)
  )
  await disputeDeps.notifyAdmin(`Dispute opened: ${family.familyName} (${money(dispute.amount, dispute.currency)})`, html, text)
}

export async function handleDisputeClosed(dispute: Stripe.Dispute, livemode: boolean): Promise<void> {
  const charge = await chargeForDispute(dispute)
  const family = await familyForCustomer(idOf(charge?.customer as string | { id: string } | null))
  if (!family) return
  const outcome = dispute.status === "won" ? "won" : dispute.status === "lost" ? "lost" : dispute.status
  if (!(await recordHistoryOnce(family, `Dispute closed ${dispute.id}: ${outcome}`))) return

  if (outcome === "lost") {
    // The money went back to the customer. REFUNDED is the closest allowed
    // payment_status; the note says it was a lost dispute.
    const invoiceId = await invoiceIdForPaymentIntent(idOf(charge?.payment_intent as string | { id: string } | null))
    const keys = [invoiceId, charge?.id].filter((k): k is string => !!k)
    if (keys.length > 0) {
      await disputeDeps.sql`
        UPDATE payment_transactions
        SET status = 'REFUNDED',
            metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ disputeLost: dispute.id })}::jsonb
        WHERE stripe_payment_id = ANY(${keys}::text[])
      `
    }
  }

  const { html, text } = adminEmail(
    `Dispute ${outcome}`,
    outcome === "won" ? "#0d9488" : "#ef4444",
    [
      ["Family", family.familyName],
      ["Owner email", family.ownerEmail],
      ["Amount", money(dispute.amount, dispute.currency)],
      ["Reason", dispute.reason],
      ["Dispute", dispute.id],
      ["Outcome", outcome],
    ],
    "The family's plan has not been changed.",
    dashboardUrl("disputes", dispute.id, livemode)
  )
  await disputeDeps.notifyAdmin(`Dispute ${outcome}: ${family.familyName}`, html, text)
}

export async function handleChargeRefunded(charge: Stripe.Charge, livemode: boolean): Promise<void> {
  const family = await familyForCustomer(idOf(charge.customer as string | { id: string } | null))
  if (!family) return
  const refunded = charge.amount_refunded
  const full = charge.refunded === true
  const invoiceId = await invoiceIdForPaymentIntent(idOf(charge.payment_intent as string | { id: string } | null))

  // The invoice's row if invoice.paid recorded one, else a row for the charge.
  const keys = [invoiceId, charge.id].filter((k): k is string => !!k)
  const existing = await disputeDeps.sql`
    SELECT id, stripe_payment_id, status, metadata FROM payment_transactions
    WHERE stripe_payment_id = ANY(${keys}::text[])
    ORDER BY (stripe_payment_id = ${charge.id}) ASC
    LIMIT 1
  `
  const prevRefunded = Number(existing[0]?.metadata?.refundedAmount ?? -1)
  if (existing.length > 0 && prevRefunded === refunded) return // redelivery: already recorded

  // payment_status has no "partially refunded": a partial refund keeps the
  // row's status and records the refunded amount in metadata.
  const meta = JSON.stringify({ refundedAmount: refunded, refundCharge: charge.id })
  if (existing.length > 0) {
    await disputeDeps.sql`
      UPDATE payment_transactions
      SET status = CASE WHEN ${full} THEN 'REFUNDED'::payment_status ELSE status END,
          metadata = COALESCE(metadata, '{}'::jsonb) || ${meta}::jsonb
      WHERE id = ${existing[0].id}
    `
  } else {
    await disputeDeps.sql`
      INSERT INTO payment_transactions (id, subscription_id, stripe_payment_id, amount, currency, status, description, metadata, created_at)
      VALUES (gen_random_uuid()::text, ${family.subscriptionId}, ${charge.id}, ${charge.amount}, ${charge.currency},
        ${full ? "REFUNDED" : "COMPLETED"}, 'refund', ${meta}::jsonb, NOW())
      ON CONFLICT (stripe_payment_id) DO NOTHING
    `
  }

  const { html, text } = adminEmail(
    full ? "Payment refunded" : "Payment partly refunded",
    "#f59e0b",
    [
      ["Family", family.familyName],
      ["Owner email", family.ownerEmail],
      ["Refunded", `${money(refunded, charge.currency)} of ${money(charge.amount, charge.currency)}`],
      ["Charge", charge.id],
    ],
    "A refund doesn't cancel the plan; the family's tier has not been changed.",
    dashboardUrl("payments", idOf(charge.payment_intent as string | { id: string } | null) ?? charge.id, livemode)
  )
  await disputeDeps.notifyAdmin(`Refund: ${family.familyName} (${money(refunded, charge.currency)})`, html, text)
}
