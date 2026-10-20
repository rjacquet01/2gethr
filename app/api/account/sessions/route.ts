import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import { sql, type Row } from '@/lib/db'
import { getUserFromRequest } from "@/lib/auth"

// GET - List the current user's active (non-revoked, non-expired) sessions,
// backing the Settings > Security > Active Sessions dialog.
export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Used only to flag which row is "this device" — never returned to the client.
    const cookieStore = await cookies()
    const currentRefreshToken = cookieStore.get("refresh_token")?.value

    const sessions = (await sql`
      SELECT id, token, user_agent, ip_address, created_at, expires_at
      FROM refresh_tokens
      WHERE user_id = ${user.id}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `) as Row<{ id: string; token: string; user_agent: string | null; ip_address: string | null; created_at: string; expires_at: string }>[]

    const data = sessions.map((s: {
      id: string
      token: string
      user_agent: string | null
      ip_address: string | null
      created_at: string
      expires_at: string
    }) => ({
      id: s.id,
      userAgent: s.user_agent,
      ipAddress: s.ip_address,
      createdAt: s.created_at,
      expiresAt: s.expires_at,
      isCurrent: !!currentRefreshToken && s.token === currentRefreshToken,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    console.error("Sessions GET error:", error)
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 })
  }
}
