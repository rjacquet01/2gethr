import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"

// Your own "Name shown to this family" (family_members.nickname), per family.
// Blank goes back to your account first name. Nobody sets another adult's
// name, and a child's name is set by a parent on the child's profile
// (lib/member-names.ts has the full rule).
const schema = z.object({ nickname: z.string().max(50) })

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const { familyId } = await params

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error: "Name must be 50 characters or fewer" }, { status: 400 })
  const nickname = parsed.data.nickname.trim()

  const me = await sql`
    SELECT id, role, nickname FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    LIMIT 1
  `
  if (me.length === 0) return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
  if (me[0].role === "CHILD") {
    return NextResponse.json({ success: false, error: "Your name is set by your parent. Ask them to change it on your profile." }, { status: 403 })
  }

  await sql`
    UPDATE family_members SET nickname = ${nickname || null}, updated_at = NOW()
    WHERE id = ${me[0].id}
  `
  await logAuditEvent(user.id, "UPDATE", "family_member", me[0].id as string, {
    oldValue: { nickname: me[0].nickname ?? null },
    newValue: { nickname: nickname || null },
  })
  return NextResponse.json({ success: true, data: { nickname } })
}
