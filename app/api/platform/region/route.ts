import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  return NextResponse.json({ country: request.headers.get("x-vercel-ip-country") || null })
}
