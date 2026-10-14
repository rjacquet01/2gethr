import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import {
  requireLegalAdmin, legalPerm, PERM_MANAGE, PERM_APPROVE, getCase, mapCase, legalLog,
  MAX_ACCESS_HOURS, DEFAULT_ACCESS_HOURS, accessActive,
} from "@/lib/legal"

type P = { params: Promise<{ caseId: string }> }

export async function GET(request: NextRequest, { params }: P) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const { caseId } = await params
    const c = await getCase(caseId)
    if (!c) return NextResponse.json({ success: false, error: "Case not found" }, { status: 404 })
    const log = await sql`
      SELECT l.id, l.action, l.detail, l.created_at, a.email AS admin_email
      FROM legal_access_log l LEFT JOIN admin_users a ON a.id::text = l.admin_id
      WHERE l.case_id = ${caseId} ORDER BY l.created_at DESC LIMIT 300
    `
    const exports_ = await sql`SELECT id, sha256, counts, created_at FROM legal_exports WHERE case_id = ${caseId} ORDER BY created_at DESC`
    const ids = [c.opened_by, c.approved_by].filter(Boolean)
    const names = ids.length ? await sql`SELECT id::text AS id, email FROM admin_users WHERE id::text = ANY(${ids}::text[])` : []
    const emailOf = (id: string | null) => names.find((n: any) => n.id === id)?.email || null
    await legalLog(caseId, g.admin.id, "CASE_VIEWED", {}, request)
    return NextResponse.json({
      success: true,
      data: {
        ...mapCase(c),
        openedByEmail: emailOf(c.opened_by),
        approvedByEmail: emailOf(c.approved_by),
        log: log.map((l: any) => ({ id: l.id, action: l.action, detail: l.detail, createdAt: l.created_at, admin: l.admin_email })),
        exports: exports_.map((x: any) => ({ id: x.id, sha256: x.sha256, counts: x.counts, createdAt: x.created_at })),
      },
      me: { id: g.admin.id, canApprove: legalPerm(g.admin, PERM_APPROVE) },
    })
  } catch (e) {
    console.error("legal case error:", e)
    return NextResponse.json({ success: false, error: "Failed to load case" }, { status: 500 })
  }
}

// Actions: counsel, approve, deny, close, preserve, emergency_review, notify_family
export async function POST(request: NextRequest, { params }: P) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const { caseId } = await params
    const c = await getCase(caseId)
    if (!c) return NextResponse.json({ success: false, error: "Case not found" }, { status: 404 })
    const b = await request.json()
    const action = String(b.action || "")
    const fail = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status })
    const needApprove = () => (legalPerm(g.admin, PERM_APPROVE) ? null : fail("Approval permission required", 403))

    switch (action) {
      case "counsel": {
        if (c.status !== "OPEN") return fail("Only open cases need counsel sign-off")
        const notes = String(b.notes || "").trim()
        if (notes.length < 5) return fail("Record who at counsel reviewed it and the outcome")
        await sql`UPDATE legal_cases SET counsel_reviewed = true, counsel_notes = ${notes} WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, "COUNSEL_REVIEWED", { notes }, request)
        break
      }
      case "approve": {
        const denied = needApprove(); if (denied) return denied
        if (c.type === "EMERGENCY") return fail("Emergency cases are active immediately; they get an after-the-fact review instead")
        const reopen = c.status === "APPROVED" && !accessActive(c)
        if (c.status !== "OPEN" && !reopen) return fail("This case can't be approved right now")
        if (c.opened_by === g.admin.id) return fail("A different person than the one who opened the case must approve it", 403)
        if (!c.counsel_reviewed) return fail("Record counsel sign-off before approving")
        if (!c.document_ref) return fail("The legal document reference is missing")
        const hours = Math.min(MAX_ACCESS_HOURS, Math.max(1, Number(b.hours) || DEFAULT_ACCESS_HOURS))
        const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString()
        await sql`UPDATE legal_cases SET status = 'APPROVED', approved_by = ${g.admin.id}, approved_at = NOW(), access_expires_at = ${expires} WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, "APPROVED", { hours, expires }, request)
        break
      }
      case "deny": {
        const denied = needApprove(); if (denied) return denied
        if (c.status !== "OPEN") return fail("Only open cases can be denied")
        const reason = String(b.reason || "").trim()
        if (!reason) return fail("Give a reason")
        await sql`UPDATE legal_cases SET status = 'DENIED', denied_reason = ${reason}, closed_by = ${g.admin.id}, closed_at = NOW() WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, "DENIED", { reason }, request)
        break
      }
      case "close": {
        if (c.status === "CLOSED" || c.status === "DENIED") return fail("Already closed")
        await sql`UPDATE legal_cases SET status = 'CLOSED', closed_by = ${g.admin.id}, closed_at = NOW(), access_expires_at = NOW() WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, "CLOSED", {}, request)
        break
      }
      case "preserve": {
        const days = Math.min(365, Math.max(0, Number(b.days) || 0))
        const until = days > 0 ? new Date(Date.now() + days * 86400 * 1000).toISOString() : null
        await sql`UPDATE legal_cases SET preserve_until = ${until} WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, until ? "PRESERVATION_SET" : "PRESERVATION_CLEARED", { days }, request)
        break
      }
      case "emergency_review": {
        const denied = needApprove(); if (denied) return denied
        if (c.type !== "EMERGENCY" || c.emergency_review_status !== "PENDING") return fail("No emergency review pending")
        if (c.opened_by === g.admin.id) return fail("A different person than the one who opened the case must review it", 403)
        const outcome = b.outcome === "NOT_JUSTIFIED" ? "NOT_JUSTIFIED" : "JUSTIFIED"
        const notes = String(b.notes || "").trim()
        if (notes.length < 5) return fail("Add review notes")
        await sql`
          UPDATE legal_cases SET emergency_review_status = ${outcome}, emergency_reviewed_by = ${g.admin.id},
            emergency_reviewed_at = NOW(), emergency_review_notes = ${notes} WHERE id = ${caseId}
        `
        await legalLog(caseId, g.admin.id, "EMERGENCY_REVIEWED", { outcome, notes }, request)
        break
      }
      case "notify_family": {
        if (c.nondisclosure) return fail("This case has a non-disclosure instruction, so the family can't be notified")
        if (c.family_notified_at) return fail("The family was already notified")
        if (c.status === "OPEN") return fail("Notify after the request has been handled")
        let familyIds: string[] = []
        if (c.scope_family_id) familyIds = [c.scope_family_id]
        else if (c.scope_user_id) {
          const f = await sql`SELECT DISTINCT family_id FROM family_members WHERE user_id = ${c.scope_user_id}`
          familyIds = f.map((x: any) => x.family_id)
        }
        const parents = familyIds.length
          ? await sql`SELECT DISTINCT user_id FROM family_members WHERE family_id = ANY(${familyIds}::text[]) AND role = 'PARENT' AND is_active = true AND user_id IS NOT NULL`
          : []
        for (const p of parents) {
          await createNotification({
            userId: p.user_id,
            type: "SYSTEM",
            title: "Legal request about your family's account",
            body: "Togethr received and responded to a legal request from a government authority involving information in your family's account. Contact support@mytogethr.com with questions.",
            data: { subType: "LEGAL_NOTICE" },
            channels: ["in_app", "push", "email"],
          }).catch((err) => console.error("legal notice failed:", err))
        }
        await sql`UPDATE legal_cases SET family_notified_at = NOW() WHERE id = ${caseId}`
        await legalLog(caseId, g.admin.id, "FAMILY_NOTIFIED", { recipients: parents.length }, request)
        break
      }
      default:
        return fail("Unknown action")
    }
    const updated = await getCase(caseId)
    return NextResponse.json({ success: true, data: mapCase(updated) })
  } catch (e) {
    console.error("legal action error:", e)
    return NextResponse.json({ success: false, error: "Action failed" }, { status: 500 })
  }
}
