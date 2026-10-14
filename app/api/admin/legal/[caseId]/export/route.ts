import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { requireLegalAdmin, PERM_MANAGE, getCase, accessActive, legalLog, sha256 } from "@/lib/legal"
import { collect, SECTIONS } from "@/lib/legal-data"

// One production file for the case: scoped data + a SHA-256 so what was handed
// over can be verified later. The file itself is not stored; the hash and counts are.
export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const g = await requireLegalAdmin(request, PERM_MANAGE)
    if ("error" in g) return NextResponse.json({ success: false, error: g.error }, { status: g.status })
    const { caseId } = await params
    const c = await getCase(caseId)
    if (!c) return NextResponse.json({ success: false, error: "Case not found" }, { status: 404 })
    if (!accessActive(c)) {
      await legalLog(caseId, g.admin.id, "ACCESS_DENIED", { reason: "export without active approval" }, request)
      return NextResponse.json({ success: false, error: "No active approval for this case" }, { status: 403 })
    }
    const bundle: Record<string, unknown> = {}
    const counts: Record<string, number> = {}
    for (const s of SECTIONS) {
      const r = await collect(c, s, 0, 50000)
      bundle[s] = r.rows
      counts[s] = s === "account" ? (r.rows[0] as any)?.users?.length || 0 : r.rows.length
    }
    const file = JSON.stringify(
      {
        caseNumber: c.case_number,
        type: c.type,
        agency: c.agency,
        generatedAt: new Date().toISOString(),
        scope: { familyId: c.scope_family_id, userId: c.scope_user_id, from: c.scope_from, to: c.scope_to },
        data: bundle,
      },
      null,
      2
    )
    const hash = sha256(file)
    await sql`INSERT INTO legal_exports (id, case_id, admin_id, sha256, counts) VALUES (${crypto.randomUUID()}, ${caseId}, ${g.admin.id}, ${hash}, ${JSON.stringify(counts)}::jsonb)`
    await legalLog(caseId, g.admin.id, "EXPORTED", { sha256: hash, counts }, request)
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${c.case_number}.json"`,
        "X-Content-SHA256": hash,
        "Access-Control-Expose-Headers": "X-Content-SHA256",
      },
    })
  } catch (e) {
    console.error("legal export error:", e)
    return NextResponse.json({ success: false, error: "Export failed" }, { status: 500 })
  }
}
