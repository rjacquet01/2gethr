import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { confirmDeviceToken } from "@/lib/device-token"
import { nameInFamily } from "@/lib/member-names"

// POST - the confirm page, signed in on the phone, vouches for the token the
// app claimed. Only the token's own account can confirm it.
export async function POST(request: NextRequest) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const code = typeof body.code === "string" ? body.code : ""
  if (!/^[0-9a-f]{48}$/.test(code)) {
    return NextResponse.json({ success: false, error: "This setup link is not valid." }, { status: 400 })
  }

  const result = await confirmDeviceToken(code, user.id)
  if (!result.ok) {
    if (result.reason === "other_account") {
      return NextResponse.json(
        {
          success: false,
          code: "OTHER_ACCOUNT",
          error: "This setup link was made from a different Togethr account, so background sharing was not turned on. Only turn it on from your own account in the Togethr app.",
        },
        { status: 403 }
      )
    }
    return NextResponse.json(
      { success: false, code: "EXPIRED", error: "This setup link has expired. Turn on background sharing again from the Location page." },
      { status: 410 }
    )
  }

  const { familyId, userId } = result.info
  const fam = await sql`SELECT name FROM families WHERE id = ${familyId} LIMIT 1`
  return NextResponse.json({
    success: true,
    name: await nameInFamily(familyId, userId),
    familyName: (fam[0]?.name as string | undefined) || "your family",
  })
}
