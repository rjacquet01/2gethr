import { NextRequest, NextResponse } from "next/server"
import { put, del } from "@vercel/blob"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

// Photo for a family member. Works for children without a login (stored on
// child_profiles.avatar_url) and for members with an account (also stored on
// the user). Allowed for yourself, or for a parent/guardian of the family.
async function authorize(
  request: NextRequest,
  familyId: string,
  memberId: string
) {
  const { user, error } = await getUserFromRequest(request)
  if (!user) {
    return { res: NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 }) }
  }
  const me = await sql`
    SELECT role FROM family_members
    WHERE family_id = ${familyId} AND user_id = ${user.id} AND is_active = true
  `
  if (me.length === 0) {
    return { res: NextResponse.json({ success: false, error: "Not a member of this family" }, { status: 403 }) }
  }
  const target = await sql`
    SELECT fm.id, fm.user_id, cp.id AS child_profile_id, cp.avatar_url
    FROM family_members fm
    LEFT JOIN child_profiles cp ON cp.family_member_id = fm.id
    WHERE fm.id = ${memberId} AND fm.family_id = ${familyId} AND fm.is_active = true
  `
  if (target.length === 0) {
    return { res: NextResponse.json({ success: false, error: "Member not found" }, { status: 404 }) }
  }
  const isAdult = me[0].role === "PARENT" || me[0].role === "GUARDIAN"
  if (target[0].user_id !== user.id && !isAdult) {
    return { res: NextResponse.json({ success: false, error: "Only parents can change someone else's photo" }, { status: 403 }) }
  }
  return { user, target: target[0] }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const auth = await authorize(request, familyId, memberId)
    if ('res' in auth) return auth.res
    const target = auth.target

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) {
      return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ success: false, error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF" }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, error: "File too large. Maximum size is 5MB" }, { status: 400 })
    }

    const fileName = `member-photos/${familyId}/${memberId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`
    const blob = await put(fileName, file, { access: "private" })

    const oldPath: string | null = target.avatar_url || null

    if (target.child_profile_id) {
      await sql`UPDATE child_profiles SET avatar_url = ${blob.pathname}, updated_at = NOW() WHERE id = ${target.child_profile_id}`
    }
    if (target.user_id) {
      await sql`
        UPDATE users SET profile_photo_path = ${blob.pathname}, profile_photo_url = ${blob.url}, updated_at = NOW()
        WHERE id = ${target.user_id}
      `
    }

    if (oldPath && oldPath.startsWith("member-photos/")) {
      try { await del(oldPath) } catch (e) { console.warn("Failed to delete old member photo:", e) }
    }

    return NextResponse.json({ success: true, data: { pathname: blob.pathname } })
  } catch (err) {
    console.error("Upload member photo error:", err)
    return NextResponse.json({ success: false, error: "Failed to upload photo" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string; memberId: string }> }
) {
  try {
    const { familyId, memberId } = await params
    const auth = await authorize(request, familyId, memberId)
    if ('res' in auth) return auth.res
    const target = auth.target

    const oldPath: string | null = target.avatar_url || null

    if (target.child_profile_id) {
      await sql`UPDATE child_profiles SET avatar_url = NULL, updated_at = NOW() WHERE id = ${target.child_profile_id}`
    }
    if (target.user_id) {
      await sql`
        UPDATE users SET profile_photo_path = NULL, profile_photo_url = NULL, updated_at = NOW()
        WHERE id = ${target.user_id}
      `
    }
    if (oldPath && oldPath.startsWith("member-photos/")) {
      try { await del(oldPath) } catch (e) { console.warn("Failed to delete member photo:", e) }
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Delete member photo error:", err)
    return NextResponse.json({ success: false, error: "Failed to remove photo" }, { status: 500 })
  }
}
