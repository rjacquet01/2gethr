import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getAdminFromRequest } from "@/lib/admin-auth"
import { ensureLegalTables, legalLog, LEGAL_ROLE } from "@/lib/legal"

// Only a SUPER_ADMIN assigns the Legal Compliance role. Every change is logged.
async function guard(request: NextRequest) {
  const { admin, error } = await getAdminFromRequest(request)
  if (!admin) return { res: NextResponse.json({ success: false, error: error || "Unauthorized" }, { status: 401 }) }
  if (!admin.roles.includes("SUPER_ADMIN")) return { res: NextResponse.json({ success: false, error: "Super admin only" }, { status: 403 }) }
  await ensureLegalTables()
  return { admin }
}

export async function GET(request: NextRequest) {
  try {
    const g = await guard(request)
    if ("res" in g) return g.res
    const rows = await sql`
      SELECT a.id::text AS id, a.email, a.first_name, a.last_name, a.status,
             EXISTS (
               SELECT 1 FROM admin_user_roles ur JOIN admin_roles r ON r.id = ur.role_id
               WHERE ur.admin_user_id = a.id AND r.name = ${LEGAL_ROLE}
             ) AS has_legal
      FROM admin_users a ORDER BY a.email
    `
    return NextResponse.json({
      success: true,
      data: rows.map((r: any) => ({ id: r.id, email: r.email, name: `${r.first_name || ""} ${r.last_name || ""}`.trim(), status: r.status, hasLegal: r.has_legal })),
      me: { id: g.admin.id },
    })
  } catch (e) {
    console.error("legal grant list error:", e)
    return NextResponse.json({ success: false, error: "Failed to load admins" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const g = await guard(request)
    if ("res" in g) return g.res
    const { adminId, grant } = await request.json()
    if (!adminId) return NextResponse.json({ success: false, error: "adminId required" }, { status: 400 })
    const target = await sql`SELECT id::text AS id, email, status FROM admin_users WHERE id::text = ${String(adminId)} LIMIT 1`
    if (target.length === 0) return NextResponse.json({ success: false, error: "Admin not found" }, { status: 404 })
    if (grant && target[0].status !== "ACTIVE") return NextResponse.json({ success: false, error: "Admin is not active" }, { status: 400 })
    if (grant) {
      await sql`
        INSERT INTO admin_user_roles (admin_user_id, role_id, granted_by)
        SELECT ${String(adminId)}::uuid, r.id, ${g.admin.id}::uuid FROM admin_roles r WHERE r.name = ${LEGAL_ROLE}
        ON CONFLICT (admin_user_id, role_id) DO NOTHING
      `
    } else {
      await sql`
        DELETE FROM admin_user_roles WHERE admin_user_id = ${String(adminId)}::uuid
          AND role_id = (SELECT id FROM admin_roles WHERE name = ${LEGAL_ROLE})
      `
    }
    await legalLog("SYSTEM", g.admin.id, grant ? "LEGAL_ROLE_GRANTED" : "LEGAL_ROLE_REVOKED", { target: target[0].email, selfGrant: g.admin.id === String(adminId) }, request)
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("legal grant error:", e)
    return NextResponse.json({ success: false, error: "Failed to update role" }, { status: 500 })
  }
}
