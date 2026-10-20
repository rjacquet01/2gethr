import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { findChildAccountInvite } from "@/lib/family-invites"
import { hitRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit"

const schema = z.object({ code: z.string().trim().min(1).max(20) })

// POST { code } - for the sign-up page: is this a parent-made code for a
// child's own account? Then the form skips the adult (18+) confirmation and
// creates the child's account. Says nothing about other kinds of code.
export async function POST(request: NextRequest) {
  const limit = await hitRateLimit(`invite-check:${clientIp(request)}`, 30, 60 * 60)
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSec, "code checks")
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ success: false, error: "Enter a code" }, { status: 400 })
  const found = await findChildAccountInvite(parsed.data.code)
  if (found.ok) {
    return NextResponse.json({
      success: true,
      data: { kind: "CHILD_ACCOUNT", childName: found.invite.childName, familyName: found.invite.familyName },
    })
  }
  return NextResponse.json({
    success: true,
    data: found.childCode ? { kind: "CHILD_ACCOUNT_UNUSABLE", error: found.error } : { kind: "OTHER" },
  })
}
