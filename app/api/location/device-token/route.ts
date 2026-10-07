import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest, checkFamilySubscription } from "@/lib/auth"
import { issueDeviceToken, revokeDeviceTokens, getDeviceTokenStatus, revokeByToken } from "@/lib/device-token"

async function resolveMember(userId: string, memberId: string | null, familyId: string | null) {
  if (!memberId || !familyId) return null
  const rows = await sql`
    SELECT id, family_id FROM family_members
    WHERE id = ${memberId} AND family_id = ${familyId} AND user_id = ${userId} AND is_active = true
    LIMIT 1
  `
  return rows[0] || null
}

// GET - is background sharing from the Android app active for this member?
export async function GET(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const member = await resolveMember(user.id, searchParams.get("memberId"), searchParams.get("familyId"))
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 })
  return NextResponse.json({ success: true, ...(await getDeviceTokenStatus(user.id, member.id)) })
}

// POST - issue a token for the native app's background service.
export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const member = await resolveMember(user.id, body.memberId ?? null, body.familyId ?? null)
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 })

  const subscription = await checkFamilySubscription(member.family_id)
  if (!subscription.features.locationSharing) {
    return NextResponse.json({ error: "Location sharing is not available on this plan" }, { status: 403 })
  }

  const token = await issueDeviceToken(user.id, member.id, member.family_id)
  return NextResponse.json({ success: true, token })
}

// DELETE - stop background sharing (revokes the token; the app stops itself).
export async function DELETE(request: NextRequest) {
  // The native app's "Stop sharing" button revokes its own token.
  const deviceToken = request.headers.get("x-device-token")
  if (deviceToken) {
    await revokeByToken(deviceToken)
    return NextResponse.json({ success: true })
  }
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const member = await resolveMember(user.id, searchParams.get("memberId"), searchParams.get("familyId"))
  if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 })
  await revokeDeviceTokens(user.id, member.id)
  return NextResponse.json({ success: true })
}
