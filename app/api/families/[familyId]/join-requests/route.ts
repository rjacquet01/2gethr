import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { ensureInviteTables, canManageInvites } from "@/lib/family-invites"

// Pending parent join requests for a family (owner / parents only).
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    if (!(await canManageInvites(familyId, user.id))) {
      return NextResponse.json({ success: false, error: "Only the family owner or a parent can see join requests" }, { status: 403 })
    }
    await ensureInviteTables()
    const rows = await sql`
      SELECT r.id, r.role, r.nickname, r.created_at, u.first_name, u.last_name, u.email
      FROM family_join_requests r JOIN users u ON u.id = r.user_id
      WHERE r.family_id = ${familyId} AND r.status = 'PENDING'
      ORDER BY r.created_at ASC
    `
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id,
        role: r.role,
        name: `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.nickname || "New member",
        email: r.email,
        createdAt: r.created_at,
      })),
    })
  } catch (error) {
    console.error("List join requests error:", error)
    return NextResponse.json({ success: false, error: "Failed to load join requests" }, { status: 500 })
  }
}
