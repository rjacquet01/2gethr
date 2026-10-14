import { NextRequest, NextResponse } from "next/server"
import { requireLegalAdmin, PERM_MANAGE, getCase, accessActive, legalLog } from "@/lib/legal"
import { collect, SECTIONS, type Section } from "@/lib/legal-data"

// Read-only view of case-scoped data. Only while the case's access window is open.
export async function GET(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const { caseId } = await params
    const c = await getCase(caseId)
    if (!c) return NextResponse.json({ success: false, error: "Case not found" }, { status: 404 })
    if (!accessActive(c)) {
      await legalLog(caseId, g.admin.id, "ACCESS_DENIED", { reason: "no active approval" }, request)
      return NextResponse.json({ success: false, error: "No active approval. Data is only available while an approved case's access window is open." }, { status: 403 })
    }
    const url = new URL(request.url)
    const section = url.searchParams.get("section") as Section
    if (!SECTIONS.includes(section)) return NextResponse.json({ success: false, error: "Unknown section" }, { status: 400 })
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0)
    const result = await collect(c, section, offset)
    await legalLog(caseId, g.admin.id, "DATA_VIEWED", { section, offset, returned: result.rows.length }, request)
    return NextResponse.json({ success: true, data: result })
  } catch (e) {
    console.error("legal data error:", e)
    return NextResponse.json({ success: false, error: "Failed to load data" }, { status: 500 })
  }
}
