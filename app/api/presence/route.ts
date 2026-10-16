import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"
import { touchPresence } from "@/lib/presence"

// POST - heartbeat from an open, visible app: "I'm here". Cheap: at most one
// database write per user per minute.
export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 })
    await touchPresence(user.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Presence heartbeat error:", error)
    return NextResponse.json({ success: false, error: "Failed" }, { status: 500 })
  }
}
