import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { canManageFamily } from "@/lib/permissions"
import { ensureInviteTables, generateInviteCode } from "@/lib/family-invites"
import { ensureAgeColumns } from "@/lib/age-schema"
import { MIN_ACCOUNT_AGE, effectiveAge } from "@/lib/age"

const INVITE_DAYS = 7

// The parent must tick the consent box; anything other than true is refused.
const schema = z.object({
  consent: z.literal(true, { errorMap: () => ({ message: "Parent consent is required to create an account for a child" }) }),
})

// Give an existing child profile (no login yet, aged 8+) its own account: a
// single-use CHILD invite bound to that profile. Whoever joins with it is
// linked to the child's existing membership instead of becoming a new member.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    if (!(await canManageFamily(familyId, user.id))) {
      return NextResponse.json({ success: false, error: "Only a parent or the family owner can create a child's account" }, { status: 403 })
    }

    schema.parse(await request.json().catch(() => ({})))
    await ensureAgeColumns()
    await ensureInviteTables()

    const rows = await sql`
      SELECT fm.id, fm.user_id, fm.role, cp.display_name, cp.age, to_char(cp.date_of_birth, 'YYYY-MM-DD') AS dob
      FROM family_members fm
      JOIN child_profiles cp ON cp.family_member_id = fm.id
      WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.is_active = true
      LIMIT 1
    `
    const c = rows[0]
    if (!c || c.role !== "CHILD") return NextResponse.json({ success: false, error: "Child not found" }, { status: 404 })
    const name = (c.display_name as string) || "This child"
    if (c.user_id) {
      return NextResponse.json({ success: false, error: `${name} already has their own account.` }, { status: 400 })
    }

    const age = effectiveAge(c.dob, c.age)
    if (age === null) {
      return NextResponse.json({ success: false, error: `Add ${name}'s birthdate first so we can check they are old enough for an account.` }, { status: 400 })
    }
    if (age < MIN_ACCOUNT_AGE) {
      return NextResponse.json({ success: false, error: `Children can have their own account from age ${MIN_ACCOUNT_AGE}.` }, { status: 400 })
    }

    // One live account code per child: cancel any earlier unused one.
    await sql`
      UPDATE family_invites SET revoked_at = NOW()
      WHERE family_id = ${familyId} AND child_member_id = ${memberId} AND used_at IS NULL AND revoked_at IS NULL
    `

    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000)
    let code = ""
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateInviteCode()
      const ins = await sql`
        INSERT INTO family_invites (id, family_id, code, role, created_by, expires_at, child_member_id, consent_by, consent_at)
        VALUES (${crypto.randomUUID()}, ${familyId}, ${code}, 'CHILD', ${user.id}, ${expiresAt.toISOString()}, ${memberId}, ${user.id}, NOW())
        ON CONFLICT (code) DO NOTHING RETURNING id
      `
      if (ins.length > 0) break
      code = ""
    }
    if (!code) return NextResponse.json({ success: false, error: "Could not create a code, try again" }, { status: 500 })

    await logAuditEvent(user.id, "CREATE", "child_account_invite", memberId, {
      newValue: { familyId, childMemberId: memberId, age, consent: true, consentBy: user.id, expiresAt },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })

    const joinLink = `${request.nextUrl.origin}/onboarding?code=${code}`
    return NextResponse.json({ success: true, data: { code, joinLink, expiresAt } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Child account invite error:", error)
    return NextResponse.json({ success: false, error: "Failed to create account invite" }, { status: 500 })
  }
}
