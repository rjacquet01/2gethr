import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { claimDeviceToken } from "@/lib/device-token"
import { nameInFamily } from "@/lib/member-names"

// POST - the Android app (1.2.6+) just received a token from a togethr-bg://
// link. Locks the token until the website confirms it on this phone, and tells
// the app whose sharing it is so the disclosure can name them.
export async function POST(request: NextRequest) {
  const token = request.headers.get("x-device-token")
  if (!token) return NextResponse.json({ success: false, error: "Missing device token" }, { status: 401 })
  const claim = await claimDeviceToken(token)
  if (!claim) return NextResponse.json({ success: false, error: "Invalid or expired device token" }, { status: 401 })

  const fam = await sql`SELECT name FROM families WHERE id = ${claim.familyId} LIMIT 1`
  return NextResponse.json({
    success: true,
    code: claim.code,
    name: await nameInFamily(claim.familyId, claim.userId),
    familyName: (fam[0]?.name as string | undefined) || "your family",
  })
}
