import { NextRequest, NextResponse } from "next/server"
import { sql } from "@/lib/db"
import { getUserFromRequest } from "@/lib/auth"
import { getGuestFamilyIds, guestCanSeeEvent, taskInvolvesUser } from "@/lib/guest-scope"

// GET - Get user's favorites
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const itemType = searchParams.get("type") // task, event, place, or null for all

    let favorites
    if (itemType) {
      favorites = await sql`
        SELECT * FROM user_favorites 
        WHERE user_id = ${user.id} AND item_type = ${itemType}
        ORDER BY created_at DESC
      `
    } else {
      favorites = await sql`
        SELECT * FROM user_favorites 
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `
    }

    // Guests only get favorites for tasks/events that involve them, and no
    // saved places at all, in the families where they are a guest.
    const guestFamilyIds = await getGuestFamilyIds(user.id)

    // Fetch the actual items for each favorite
    const enrichedFavorites = await Promise.all(
      favorites.map(async (fav) => {
        let item = null
        if (fav.item_type === 'task') {
          const tasks = await sql`SELECT id, title, status, priority, due_date, family_id, created_by_id, assigned_to_id FROM tasks WHERE id = ${fav.item_id}`
          const t = tasks[0]
          if (t && (!guestFamilyIds.includes(t.family_id) || taskInvolvesUser(t, user.id))) {
            item = { id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date }
          }
        } else if (fav.item_type === 'event') {
          const events = await sql`
            SELECT e.id, e.title, e.start_time, e.end_time, e.event_type, c.family_id
            FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE e.id = ${fav.item_id}
          `
          const e = events[0]
          if (e && (!guestFamilyIds.includes(e.family_id) || (await guestCanSeeEvent(user.id, e.id)))) {
            item = { id: e.id, title: e.title, start_time: e.start_time, end_time: e.end_time, event_type: e.event_type }
          }
        } else if (fav.item_type === 'place') {
          const places = await sql`SELECT id, name, address, icon, color, family_id FROM saved_places WHERE id = ${fav.item_id}`
          const p = places[0]
          if (p && !guestFamilyIds.includes(p.family_id)) {
            item = { id: p.id, name: p.name, address: p.address, icon: p.icon, color: p.color }
          }
        }
        return { ...fav, item }
      })
    )

    // Filter out favorites where the item no longer exists
    const validFavorites = enrichedFavorites.filter(f => f.item !== null)

    return NextResponse.json({
      success: true,
      data: validFavorites,
    })
  } catch (error) {
    console.error("Get favorites error:", error)
    return NextResponse.json({ success: false, error: "Failed to get favorites" }, { status: 500 })
  }
}

// POST - Add a favorite
export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }

    const body = await request.json()
    const { itemType, itemId } = body

    if (!itemType || !itemId) {
      return NextResponse.json({ success: false, error: "itemType and itemId are required" }, { status: 400 })
    }

    if (!['task', 'event', 'place'].includes(itemType)) {
      return NextResponse.json({ success: false, error: "Invalid item type" }, { status: 400 })
    }

    // Check if already favorited
    const existing = await sql`
      SELECT id FROM user_favorites 
      WHERE user_id = ${user.id} AND item_type = ${itemType} AND item_id = ${itemId}
    `

    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: "Already favorited" }, { status: 400 })
    }

    const id = crypto.randomUUID()
    await sql`
      INSERT INTO user_favorites (id, user_id, item_type, item_id, created_at)
      VALUES (${id}, ${user.id}, ${itemType}, ${itemId}, NOW())
    `

    return NextResponse.json({
      success: true,
      data: { id, itemType, itemId },
    })
  } catch (error) {
    console.error("Add favorite error:", error)
    return NextResponse.json({ success: false, error: "Failed to add favorite" }, { status: 500 })
  }
}

// DELETE - Remove a favorite
export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ success: false, error: error || "Not authenticated" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const itemType = searchParams.get("type")
    const itemId = searchParams.get("itemId")

    if (!itemType || !itemId) {
      return NextResponse.json({ success: false, error: "type and itemId are required" }, { status: 400 })
    }

    await sql`
      DELETE FROM user_favorites 
      WHERE user_id = ${user.id} AND item_type = ${itemType} AND item_id = ${itemId}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Remove favorite error:", error)
    return NextResponse.json({ success: false, error: "Failed to remove favorite" }, { status: 500 })
  }
}
