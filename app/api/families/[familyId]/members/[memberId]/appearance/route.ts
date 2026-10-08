import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { ensureMemberAppearanceColumns } from "@/lib/member-appearance"
import { z } from "zod"

const schema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  emoji: z.string().max(16).nullable().optional(),
})

// Change a member's avatar color/emoji. Allowed for yourself or for parents.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }
    await ensureMemberAppearanceColumns()

    const me = await sql`
      SELECT role FROM family_members
      WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
    `
    if (me.length === 0) {
      return NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 })
    }
    const target = await sql`
      SELECT id, user_id FROM family_members
      WHERE id = ${memberId} AND family_id = ${familyId} AND is_active = true
    `
    if (target.length === 0) {
      return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 })
    }
    if (target[0].user_id !== user.id && me[0].role !== "PARENT") {
      return NextResponse.json({ success: false, error: "Only parents can change someone else's look" }, { status: 403 })
    }

    const body = schema.parse(await request.json())
    const setColor = body.color !== undefined
    const setEmoji = body.emoji !== undefined
    await sql`
      UPDATE family_members SET
        color = CASE WHEN ${setColor} THEN ${body.color ?? null} ELSE color END,
        emoji = CASE WHEN ${setEmoji} THEN ${body.emoji || null} ELSE emoji END
      WHERE id = ${memberId}
    `
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: "Invalid color or emoji" }, { status: 400 })
    }
    console.error("Update appearance error:", err)
    return NextResponse.json({ success: false, error: "Failed to update" }, { status: 500 })
  }
}
