import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { isAdultMemberRole } from "@/lib/permissions"
import { ensureLocationAccessTable } from "@/lib/location-access"
import { insertNotification } from "@/lib/location-approval"
import { sendPushToUser, isFirebaseConfigured } from "@/lib/services/push"
import { hitRateLimit } from "@/lib/rate-limit"
import { memberName } from "@/lib/member-names"

// Grown-ups asking each other for ongoing location access (see
// lib/location-access.ts). Children and guests take no part.

type Status = "NONE" | "PENDING" | "APPROVED"

async function myGrownUpMembership(familyId: string, userId: string) {
  const rows = await sql`
    SELECT id, role FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${userId} AND is_active = true
    LIMIT 1
  `
  return rows[0] && isAdultMemberRole(rows[0].role as string) ? (rows[0].id as string) : null
}

// Adults only here (role is never CHILD).
const displayName = (r: Record<string, unknown>) =>
  memberName({ nickname: r.nickname as string, firstName: r.first_name as string, lastName: r.last_name as string }, { withLastName: true })

// The other grown-ups in the family, with access both ways.
export async function GET(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
  const familyId = request.nextUrl.searchParams.get("familyId") || user.primaryFamily?.id
  if (!familyId) return NextResponse.json({ success: false, error: "No family specified" }, { status: 400 })

  const myMemberId = await myGrownUpMembership(familyId, user.id)
  if (!myMemberId) return NextResponse.json({ success: true, data: { people: [] } })

  try {
    await ensureLocationAccessTable()
    const rows = await sql`
      SELECT fm.id AS member_id, fm.nickname, fm.color, fm.emoji, u.first_name, u.last_name,
             mine.status AS i_can_see, theirs.status AS they_can_see
      FROM family_members fm
      JOIN users u ON u.id = fm.user_id
      LEFT JOIN location_access_grants mine ON mine.owner_member_id = fm.id AND mine.viewer_member_id = ${myMemberId}
      LEFT JOIN location_access_grants theirs ON theirs.owner_member_id = ${myMemberId} AND theirs.viewer_member_id = fm.id
      WHERE fm.family_id = ${familyId} AND fm.is_active = true AND fm.id <> ${myMemberId}
        AND fm.role IN ('PARENT', 'GUARDIAN', 'ADULT')
      ORDER BY u.first_name
    `
    return NextResponse.json({
      success: true,
      data: {
        people: rows.map((r) => ({
          memberId: r.member_id,
          name: displayName(r),
          color: r.color ?? null,
          emoji: r.emoji ?? null,
          iCanSee: (r.i_can_see ?? "NONE") as Status,
          theyCanSee: (r.they_can_see ?? "NONE") as Status,
        })),
      },
    })
  } catch (error) {
    console.error("Location access GET error:", error)
    return NextResponse.json({ success: false, error: "Failed to load location access" }, { status: 500 })
  }
}

const actionSchema = z.object({
  familyId: z.string().min(1),
  memberId: z.string().min(1),
  // request/cancel: about seeing them. approve/deny/revoke: about them seeing me.
  action: z.enum(["request", "cancel", "approve", "deny", "revoke"]),
})

export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })

  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 })
  const { familyId, memberId, action } = parsed.data

  const myMemberId = await myGrownUpMembership(familyId, user.id)
  if (!myMemberId) {
    return NextResponse.json({ success: false, error: "Only adults in this family can do this" }, { status: 403 })
  }
  const other = await sql`
    SELECT fm.id, fm.user_id, fm.role FROM family_members fm
    WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.is_active = true AND fm.user_id IS NOT NULL
    LIMIT 1
  `
  if (other.length === 0 || other[0].id === myMemberId || !isAdultMemberRole(other[0].role as string)) {
    return NextResponse.json({ success: false, error: "Member not found" }, { status: 404 })
  }
  const otherUserId = other[0].user_id as string
  const myName = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "A family member"

  try {
    await ensureLocationAccessTable()

    if (action === "request") {
      const limit = await hitRateLimit(`loc-access:${myMemberId}:${memberId}`, 3, 24 * 60 * 60)
      if (!limit.allowed) {
        return NextResponse.json({ success: false, error: "You've asked a few times today. Try again tomorrow." }, { status: 429 })
      }
      const inserted = await sql`
        INSERT INTO location_access_grants (id, family_id, owner_member_id, viewer_member_id, status, created_at)
        VALUES (${`locacc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`}, ${familyId}, ${memberId}, ${myMemberId}, 'PENDING', NOW())
        ON CONFLICT (owner_member_id, viewer_member_id) DO NOTHING
        RETURNING id
      `
      if (inserted.length > 0) {
        const title = "Location access request"
        const body = `${myName} would like to see your location. Approve or deny on the Location page.`
        await insertNotification(otherUserId, title, body, { subType: "LOCATION_ACCESS_REQUEST", familyId, memberId: myMemberId })
          .catch((e) => console.error("access request in-app failed:", e))
        if (isFirebaseConfigured()) {
          await sendPushToUser(otherUserId, { title, body, data: { type: "LOCATION_ACCESS_REQUEST" }, clickAction: "/location" })
            .catch((e) => console.error("access request push failed:", e))
        }
      }
      return NextResponse.json({ success: true })
    }

    if (action === "cancel") {
      await sql`DELETE FROM location_access_grants WHERE owner_member_id = ${memberId} AND viewer_member_id = ${myMemberId}`
      return NextResponse.json({ success: true })
    }

    if (action === "approve") {
      const updated = await sql`
        UPDATE location_access_grants SET status = 'APPROVED', decided_at = NOW()
        WHERE owner_member_id = ${myMemberId} AND viewer_member_id = ${memberId} AND status = 'PENDING'
        RETURNING id
      `
      if (updated.length === 0) {
        return NextResponse.json({ success: false, error: "No request to approve" }, { status: 404 })
      }
      await insertNotification(otherUserId, "Location access approved", `${myName} approved. You can now see their location when they're sharing.`, {
        subType: "LOCATION_ACCESS_APPROVED", familyId, memberId: myMemberId,
      }).catch((e) => console.error("access approved in-app failed:", e))
      return NextResponse.json({ success: true })
    }

    // deny (a pending request) or revoke (any access): they stop seeing me.
    await sql`
      DELETE FROM location_access_grants
      WHERE owner_member_id = ${myMemberId} AND viewer_member_id = ${memberId}
        AND (${action === "revoke"} OR status = 'PENDING')
    `
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Location access POST error:", error)
    return NextResponse.json({ success: false, error: "Failed to update location access" }, { status: 500 })
  }
}
