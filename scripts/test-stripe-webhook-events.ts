// Usage: npx tsx --tsconfig tsconfig.json scripts/test-stripe-webhook-events.ts
// Disputes and refunds through the real webhook route (signature checked on
// the raw body), with an in-memory fake database, fake Stripe lookups and a
// fake notifyAdmin. Nothing touches a real database or Stripe: DATABASE_URL
// points at a closed local port and the Stripe key is a placeholder.
import assert from "node:assert"

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/never_connected"
process.env.STRIPE_SECRET_KEY = "sk_test_placeholder_never_called"
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_webhook_secret_not_real"

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ok  ${name}`) }

type Row = Record<string, any>

async function main() {
  const { NextRequest } = await import("next/server")
  const { stripe } = await import("../lib/stripe")
  const { disputeDeps } = await import("../lib/stripe-disputes")
  const route = await import("../app/api/webhooks/stripe/route")

  // ---- fake database ----------------------------------------------------------
  const db = {
    subscriptions: [
      { subscription_id: "subrow_1", family_id: "fam_1", status: "ACTIVE", tier: "PREMIUM", stripe_customer_id: "cus_known", family_name: "Test <Family>", owner_email: "owner@example.invalid" },
    ] as Row[],
    history: [] as Row[],
    payments: [
      { id: "pt_1", stripe_payment_id: "in_paid_1", status: "COMPLETED", amount: 999, metadata: { hostedInvoiceUrl: null } },
      { id: "pt_2", stripe_payment_id: "in_paid_2", status: "COMPLETED", amount: 999, metadata: {} },
    ] as Row[],
    queries: [] as string[],
  }
  const fakeSql = async (strings: TemplateStringsArray, ...v: unknown[]): Promise<Row[]> => {
    const q = strings.join("?").replace(/\s+/g, " ").trim()
    db.queries.push(q)
    if (q.includes("FROM subscriptions s")) {
      return db.subscriptions.filter((s) => s.stripe_customer_id === v[0]).slice(0, 1)
    }
    if (q.startsWith("SELECT 1 FROM subscription_status_history")) {
      return db.history.filter((h) => h.subscription_id === v[0] && h.notes === v[1]).slice(0, 1).map(() => ({ "?column?": 1 }))
    }
    if (q.startsWith("INSERT INTO subscription_status_history")) {
      db.history.push({ subscription_id: v[0], old_status: v[1], new_status: v[2], notes: v[3], source: "WEBHOOK" })
      return []
    }
    if (q.startsWith("UPDATE payment_transactions SET status = 'REFUNDED'")) {
      const extra = JSON.parse(v[0] as string)
      for (const p of db.payments) if ((v[1] as string[]).includes(p.stripe_payment_id)) { p.status = "REFUNDED"; p.metadata = { ...p.metadata, ...extra } }
      return []
    }
    if (q.startsWith("SELECT id, stripe_payment_id, status, metadata FROM payment_transactions")) {
      const keys = v[0] as string[]
      const chargeId = v[1] as string
      return db.payments.filter((p) => keys.includes(p.stripe_payment_id))
        .sort((a, b) => Number(a.stripe_payment_id === chargeId) - Number(b.stripe_payment_id === chargeId)).slice(0, 1)
    }
    if (q.startsWith("UPDATE payment_transactions SET status = CASE")) {
      const p = db.payments.find((x) => x.id === v[2])!
      if (v[0]) p.status = "REFUNDED"
      p.metadata = { ...p.metadata, ...JSON.parse(v[1] as string) }
      return []
    }
    if (q.startsWith("INSERT INTO payment_transactions")) {
      if (!db.payments.some((p) => p.stripe_payment_id === v[1])) {
        db.payments.push({ id: `pt_${db.payments.length + 1}`, subscription_id: v[0], stripe_payment_id: v[1], amount: v[2], currency: v[3], status: v[4], metadata: JSON.parse(v[5] as string) })
      }
      return []
    }
    throw new Error(`unexpected query in test: ${q}`)
  }
  disputeDeps.sql = fakeSql as typeof disputeDeps.sql

  const mails: { subject: string; html: string; text?: string }[] = []
  disputeDeps.notifyAdmin = async (subject: string, html: string, text?: string) => { mails.push({ subject, html, text }) }

  // ---- fake Stripe lookups (no network) -----------------------------------------------
  const charges: Record<string, Row> = {
    ch_known: { id: "ch_known", customer: "cus_known", payment_intent: "pi_1", amount: 999, currency: "usd" },
    ch_unknown: { id: "ch_unknown", customer: "cus_nobody", payment_intent: "pi_x", amount: 500, currency: "usd" },
  }
  const invoiceByPi: Record<string, string> = { pi_1: "in_paid_1", pi_2: "in_paid_2" }
  ;(stripe.charges as any).retrieve = async (id: string) => {
    if (!charges[id]) throw Object.assign(new Error("No such charge"), { code: "resource_missing" })
    return charges[id]
  }
  ;(stripe.invoicePayments as any).list = async (p: { payment: { payment_intent: string } }) => ({
    data: invoiceByPi[p.payment.payment_intent] ? [{ invoice: invoiceByPi[p.payment.payment_intent] }] : [],
  })

  // ---- helpers ---------------------------------------------------------------------------
  const secret = process.env.STRIPE_WEBHOOK_SECRET!
  const event = (id: string, type: string, object: Row) =>
    JSON.stringify({ id, object: "event", type, livemode: false, created: 1760000000, api_version: "2026-08-26.dahlia", data: { object } })
  const send = async (payload: string, sig?: string) => {
    const header = sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret })
    const req = new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": header, "content-type": "application/json" }, body: payload })
    return route.POST(req)
  }
  const touchedSubscriptions = () => db.queries.filter((q) => /UPDATE subscriptions|INSERT INTO subscriptions/i.test(q))

  const dispute = (status: string) => ({
    id: "du_1", object: "dispute", amount: 999, currency: "usd", reason: "fraudulent", status, charge: "ch_known",
    payment_intent: "pi_1", livemode: false, evidence_details: { due_by: 1761000000 },
  })

  // 1. dispute opened: admin told, history noted, tier untouched, once only.
  console.log("charge.dispute.created")
  {
    const payload = event("evt_d1", "charge.dispute.created", dispute("needs_response"))
    let r = await send(payload)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(mails.length, 1)
    const m = mails[0]
    assert.match(m.subject, /^Dispute opened: Test <Family> \(9\.99 USD\)$/)
    assert.ok(m.html.includes("Test &lt;Family&gt;"), "family name is escaped in the HTML")
    assert.ok(m.html.includes("owner@example.invalid") && m.html.includes("fraudulent") && m.html.includes("du_1"))
    assert.ok(m.html.includes(new Date(1761000000 * 1000).toISOString()), "evidence due date included")
    assert.ok(m.html.includes("https://dashboard.stripe.com/test/disputes/du_1"), "dashboard link (test mode)")
    assert.ok(/evidence by the due date/.test(m.text || ""))
    ok("admin notified with family, owner, amount, reason, id, due date and dashboard link")
    assert.deepStrictEqual(db.history.map((h) => [h.notes, h.old_status, h.new_status, h.source]), [["Dispute opened du_1", "ACTIVE", "ACTIVE", "WEBHOOK"]])
    assert.deepStrictEqual(touchedSubscriptions(), [])
    assert.strictEqual(db.subscriptions[0].tier, "PREMIUM")
    ok("history row with status unchanged; tier and status never written")
    r = await send(payload)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(mails.length, 1, "no second email on redelivery")
    assert.strictEqual(db.history.length, 1, "no second history row")
    ok("redelivery does nothing twice")
  }

  // 2. dispute lost: payment marked, admin told, tier untouched.
  console.log("charge.dispute.closed")
  {
    mails.length = 0
    const payload = event("evt_d2", "charge.dispute.closed", dispute("lost"))
    assert.strictEqual((await send(payload)).status, 200)
    const p = db.payments.find((x) => x.stripe_payment_id === "in_paid_1")!
    assert.strictEqual(p.status, "REFUNDED")
    assert.strictEqual(p.metadata.disputeLost, "du_1")
    assert.strictEqual(mails.length, 1)
    assert.match(mails[0].subject, /^Dispute lost: /)
    assert.deepStrictEqual(touchedSubscriptions(), [])
    ok("lost: payment row REFUNDED with the dispute noted; admin told; tier unchanged")
    assert.strictEqual((await send(payload)).status, 200)
    assert.strictEqual(mails.length, 1)
    ok("redelivery of the closed event: no second email")
    mails.length = 0
    const won = event("evt_d3", "charge.dispute.closed", { ...dispute("won"), id: "du_2" })
    assert.strictEqual((await send(won)).status, 200)
    assert.match(mails[0].subject, /^Dispute won: /)
    ok("won: admin told the outcome")
  }

  // 3. refunds: recorded once, partial keeps status.
  console.log("charge.refunded")
  {
    mails.length = 0
    const full = { id: "ch_2", object: "charge", customer: "cus_known", payment_intent: "pi_2", amount: 999, amount_refunded: 999, refunded: true, currency: "usd" }
    const payload = event("evt_r1", "charge.refunded", full)
    assert.strictEqual((await send(payload)).status, 200)
    const p = db.payments.find((x) => x.stripe_payment_id === "in_paid_2")!
    assert.strictEqual(p.status, "REFUNDED")
    assert.strictEqual(p.metadata.refundedAmount, 999)
    assert.strictEqual(mails.length, 1)
    assert.match(mails[0].subject, /^Refund: Test <Family> \(9\.99 USD\)$/)
    const before = db.payments.length
    assert.strictEqual((await send(payload)).status, 200)
    assert.strictEqual(db.payments.length, before, "no new row")
    assert.strictEqual(mails.length, 1, "no second email")
    assert.deepStrictEqual(touchedSubscriptions(), [])
    ok("full refund updates the invoice's row once; redelivery changes nothing; tier unchanged")

    mails.length = 0
    const partial = { id: "ch_3", object: "charge", customer: "cus_known", payment_intent: "pi_none", amount: 2000, amount_refunded: 500, refunded: false, currency: "usd" }
    const pp = event("evt_r2", "charge.refunded", partial)
    assert.strictEqual((await send(pp)).status, 200)
    assert.strictEqual((await send(pp)).status, 200)
    const rows = db.payments.filter((x) => x.stripe_payment_id === "ch_3")
    assert.strictEqual(rows.length, 1, "one row for the charge even after redelivery")
    assert.strictEqual(rows[0].status, "COMPLETED")
    assert.strictEqual(rows[0].metadata.refundedAmount, 500)
    assert.strictEqual(mails.length, 1)
    ok("partial refund with no invoice row: one charge row, status kept, amount noted")
  }

  // 4. unknown customer: 200, nothing written, nobody emailed.
  console.log("unknown customer")
  {
    mails.length = 0
    const writesBefore = db.queries.filter((q) => /^(INSERT|UPDATE)/.test(q)).length
    for (const [id, type, obj] of [
      ["evt_u1", "charge.dispute.created", { ...dispute("needs_response"), id: "du_x", charge: "ch_unknown" }],
      ["evt_u2", "charge.refunded", { id: "ch_unknown", object: "charge", customer: "cus_nobody", payment_intent: "pi_x", amount: 500, amount_refunded: 500, refunded: true, currency: "usd" }],
      ["evt_u3", "charge.dispute.created", { ...dispute("needs_response"), id: "du_y", charge: "ch_missing" }],
    ] as [string, string, Row][]) {
      assert.strictEqual((await send(event(id, type, obj))).status, 200, type)
    }
    assert.strictEqual(mails.length, 0)
    assert.strictEqual(db.queries.filter((q) => /^(INSERT|UPDATE)/.test(q)).length, writesBefore)
    ok("unknown customer (or missing charge) returns 200 and does nothing")
  }

  // 5. signature still enforced on the raw body.
  console.log("signature")
  {
    const payload = event("evt_bad", "charge.refunded", { id: "ch_2", customer: "cus_known" })
    const goodSig = stripe.webhooks.generateTestHeaderString({ payload, secret })
    const realError = console.error
    console.error = () => {}
    try {
      assert.strictEqual((await send(payload, "t=1,v1=deadbeef")).status, 400)
      assert.strictEqual((await send(payload + " ", goodSig)).status, 400, "body changed after signing")
      const wrong = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" })
      assert.strictEqual((await send(payload, wrong)).status, 400)
    } finally {
      console.error = realError
    }
    const noSig = new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", body: payload })
    assert.strictEqual((await route.POST(noSig)).status, 400)
    ok("bad, tampered, wrong-secret and missing signatures return 400")
  }

  console.log(`\nAll ${passed} webhook event checks passed.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
