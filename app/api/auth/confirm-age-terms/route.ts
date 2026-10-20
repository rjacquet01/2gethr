import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getUserFromRequest } from "@/lib/auth"
import { confirmAgeTerms } from "@/lib/existing-user-confirmations"

// An adult who signed up before the age rule confirms, once, that they are
// 18+ and accept the Terms and Privacy Policy. Both must be exactly true,
// checked here (not just in the dialog). Child accounts are refused.
const schema = z.object({
  ageConfirmed: z.literal(true, { errorMap: () => ({ message: "You must be 18 or older to use a Togethr account" }) }),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms of Service and Privacy Policy" }) }),
})

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    schema.parse(await request.json().catch(() => ({})))

    const result = await confirmAgeTerms(user.id, request)
    if (result === "child") {
      return NextResponse.json({ success: false, error: "A child's account doesn't need this confirmation" }, { status: 403 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ success: false, error: error.errors[0].message }, { status: 400 })
    console.error("Confirm age and terms error:", error)
    return NextResponse.json({ success: false, error: "Failed to save your confirmation" }, { status: 500 })
  }
}
