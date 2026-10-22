import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest, logAuditEvent } from "@/lib/auth"
import { ensureInviteTables, generateInviteCode, canManageInvites, INVITE_ROLES } from "@/lib/family-invites"
import { sendEmail, isResendConfigured, EMAIL_TEMPLATES } from "@/lib/services/email"
import { actorNameInFamily } from "@/lib/member-names"

const INVITE_DAYS = 7
const MAX_ACTIVE = 20

// Join codes here are for adults (parents and guests). A child's invite is
// made with the parent's consent for a child profile
// (children/[memberId]/account-invite), so their account joins that profile.
// email (optional): where to send the invite link. Used only to send it:
// never stored or logged.
const createSchema = z.object({
  role: z.enum(INVITE_ROLES).refine((r) => r !== "CHILD", {
    message: "Invite a child from Invite > Child, which asks for your consent.",
  }),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email address").max(254)]).optional(),
})

async function guard(request: NextRequest, familyId: string) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) return { ok: false as const, res: NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 }) }
  const fam = await sql`SELECT id FROM families WHERE id = ${familyId} LIMIT 1`
  if (fam.length === 0) return { ok: false as const, res: NextResponse.json({ success: false, error: "Family not found" }, { status: 404 }) }
  if (!(await canManageInvites(familyId, user.id))) {
    return { ok: false as const, res: NextResponse.json({ success: false, error: "Only the family owner or a parent can manage invite codes" }, { status: 403 }) }
  }
  await ensureInviteTables()
  return { ok: true as const, user }
}

// List the codes that can still be used.
export async function GET(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const g = await guard(request, familyId)
    if (!g.ok) return g.res
    // A child's invite names the child it is for.
    const rows = await sql`
      SELECT i.code, i.role, i.created_at, i.expires_at, cp.display_name AS child_name
      FROM family_invites i
      LEFT JOIN child_profiles cp ON cp.family_member_id = i.child_member_id
      WHERE i.family_id = ${familyId} AND i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
      ORDER BY i.created_at DESC
    `
    return NextResponse.json({
      success: true,
      data: rows.map((r) => ({ code: r.code, role: r.role, childName: r.child_name ?? null, createdAt: r.created_at, expiresAt: r.expires_at })),
    })
  } catch (error) {
    console.error("List invites error:", error)
    return NextResponse.json({ success: false, error: "Failed to load invite codes" }, { status: 500 })
  }
}

// Create a single-use code that is bound to a role.
export async function POST(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const g = await guard(request, familyId)
    if (!g.ok) return g.res
    const { role, email } = createSchema.parse(await request.json())

    const active = await sql`
      SELECT COUNT(*)::int AS n FROM family_invites
      WHERE family_id = ${familyId} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
    `
    if (active[0].n >= MAX_ACTIVE) {
      return NextResponse.json({ success: false, error: "Too many unused codes. Cancel some before creating more." }, { status: 400 })
    }

    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000)
    let code = ""
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateInviteCode()
      const ins = await sql`
        INSERT INTO family_invites (id, family_id, code, role, created_by, expires_at)
        VALUES (${crypto.randomUUID()}, ${familyId}, ${code}, ${role}, ${g.user.id}, ${expiresAt.toISOString()})
        ON CONFLICT (code) DO NOTHING RETURNING id
      `
      if (ins.length > 0) break
      code = ""
    }
    if (!code) return NextResponse.json({ success: false, error: "Could not create a code, try again" }, { status: 500 })
    const joinLink = `${request.nextUrl.origin}/onboarding?code=${code}`

    // Email the link when an address was given.
    let emailed = false
    let emailError: string | undefined
    if (email && !isResendConfigured()) {
      emailError = "Email isn't set up, so share the link instead."
    } else if (email) {
      const fam = await sql`SELECT name FROM families WHERE id = ${familyId} LIMIT 1`
      const inviterName = await actorNameInFamily(familyId, g.user, "A family member")
      const tpl = EMAIL_TEMPLATES.FAMILY_JOIN_INVITE(role as "PARENT" | "GUEST", inviterName, (fam[0]?.name as string) || null, joinLink, code)
      const sent = await sendEmail({ to: email, ...tpl })
      emailed = sent.success
      if (!emailed) emailError = "The email could not be sent. Share the link instead."
    }

    await logAuditEvent(g.user.id, "CREATE", "family_invite", familyId, {
      newValue: { role, expiresAt, emailed },
      ipAddress: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || undefined,
      userAgent: request.headers.get("user-agent") || undefined,
    })
    return NextResponse.json({ success: true, data: { code, role, expiresAt, joinLink, emailed, ...(emailError ? { emailError } : {}) } })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Create invite error:", error)
    return NextResponse.json({ success: false, error: "Failed to create invite code" }, { status: 500 })
  }
}

// Cancel an unused code.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ familyId: string }> }) {
  try {
    const { familyId } = await params
    const g = await guard(request, familyId)
    if (!g.ok) return g.res
    const code = new URL(request.url).searchParams.get("code")?.toUpperCase()
    if (!code) return NextResponse.json({ success: false, error: "Code is required" }, { status: 400 })
    await sql`
      UPDATE family_invites SET revoked_at = NOW()
      WHERE family_id = ${familyId} AND code = ${code} AND used_at IS NULL AND revoked_at IS NULL
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Revoke invite error:", error)
    return NextResponse.json({ success: false, error: "Failed to cancel invite code" }, { status: 500 })
  }
}
