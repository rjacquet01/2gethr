import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { requireLegalAdmin, PERM_MANAGE, CASE_TYPES, nextCaseNumber, legalLog, mapCase, EMERGENCY_ACCESS_HOURS } from "@/lib/legal"

// List cases / open a new case. Needs the Legal Compliance role (not implied by SUPER_ADMIN).
export async function GET(request: NextRequest) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const rows = await sql`SELECT * FROM legal_cases ORDER BY opened_at DESC LIMIT 200`
    return NextResponse.json({ success: true, data: rows.map(mapCase), me: { id: g.admin.id } })
  } catch (e) {
    console.error("legal list error:", e)
    return NextResponse.json({ success: false, error: "Failed to load cases" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const b = await request.json()

    const type = String(b.type || "")
    if (!(CASE_TYPES as readonly string[]).includes(type)) return NextResponse.json({ success: false, error: "Choose a request type" }, { status: 400 })
    const req = (k: string) => String(b[k] || "").trim()
    for (const k of ["agency", "requesterName", "requesterContact"]) {
      if (!req(k)) return NextResponse.json({ success: false, error: "Agency, requester name and contact are required" }, { status: 400 })
    }
    const isEmergency = type === "EMERGENCY"
    if (isEmergency && req("emergencyReason").length < 20) {
      return NextResponse.json({ success: false, error: "Describe the imminent danger (at least a sentence) for an emergency request" }, { status: 400 })
    }
    if (!isEmergency && !req("documentRef")) {
      return NextResponse.json({ success: false, error: "Reference the legal document (docket / warrant number and where the copy is stored)" }, { status: 400 })
    }

    // Scope: a family and/or a person, plus a date range. Look up by email for convenience.
    let scopeUserId: string | null = null
    if (req("userEmail")) {
      const u = await sql`SELECT id FROM users WHERE email = ${req("userEmail").toLowerCase()} LIMIT 1`
      if (u.length === 0) return NextResponse.json({ success: false, error: "No account with that email" }, { status: 404 })
      scopeUserId = u[0].id
    }
    const scopeFamilyId = req("familyId") || null
    if (scopeFamilyId) {
      const f = await sql`SELECT id FROM families WHERE id = ${scopeFamilyId} LIMIT 1`
      if (f.length === 0) return NextResponse.json({ success: false, error: "Family not found" }, { status: 404 })
    }
    if (!scopeUserId && !scopeFamilyId) return NextResponse.json({ success: false, error: "Name the person (email) or family ID the request covers" }, { status: 400 })
    const from = new Date(b.scopeFrom), to = new Date(b.scopeTo)
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from >= to) return NextResponse.json({ success: false, error: "Enter a valid date range" }, { status: 400 })

    const id = crypto.randomUUID()
    const caseNumber = await nextCaseNumber()
    const accessExpires = isEmergency ? new Date(Date.now() + EMERGENCY_ACCESS_HOURS * 3600 * 1000).toISOString() : null
    await sql`
      INSERT INTO legal_cases (
        id, case_number, type, status, agency, requester_name, requester_contact, reference_number, document_ref, summary,
        scope_family_id, scope_user_id, scope_from, scope_to, includes_live_ping, nondisclosure,
        emergency_reason, emergency_review_status, opened_by, approved_at, access_expires_at
      ) VALUES (
        ${id}, ${caseNumber}, ${type}, ${isEmergency ? "APPROVED" : "OPEN"}, ${req("agency")}, ${req("requesterName")}, ${req("requesterContact")},
        ${req("referenceNumber") || null}, ${req("documentRef") || null}, ${req("summary") || null},
        ${scopeFamilyId}, ${scopeUserId}, ${from.toISOString()}, ${to.toISOString()}, ${!!b.includesLivePing}, ${!!b.nondisclosure},
        ${isEmergency ? req("emergencyReason") : null}, ${isEmergency ? "PENDING" : null}, ${g.admin.id},
        ${isEmergency ? new Date().toISOString() : null}, ${accessExpires}
      )
    `
    await legalLog(id, g.admin.id, isEmergency ? "EMERGENCY_OPENED" : "CASE_OPENED", { caseNumber, type, agency: req("agency"), scopeFamilyId, scopeUserId }, request)
    return NextResponse.json({ success: true, data: { id, caseNumber } })
  } catch (e) {
    console.error("legal create error:", e)
    return NextResponse.json({ success: false, error: "Failed to open case" }, { status: 500 })
  }
}
