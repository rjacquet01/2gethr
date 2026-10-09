import { NextRequest, NextResponse } from "next/server"
import { getUserFromRequest } from "@/lib/auth"

// Turn a free-text address into coordinates, so a saved place's geofence
// is actually centered on the address the user typed instead of a random
// point. Tries Google's Geocoding API first if a key is configured
// (reuses the same key already used for the location map embed), then
// falls back to OpenStreetMap's Nominatim, which needs no API key.
export async function GET(request: NextRequest) {
  try {
    const { user, error } = await getUserFromRequest(request)

    if (!user) {
      return NextResponse.json(
        { success: false, error: error || "Not authenticated" },
        { status: 401 }
      )
    }

    const latParam = request.nextUrl.searchParams.get("lat")
    const lngParam = request.nextUrl.searchParams.get("lng")
    if (latParam && lngParam) {
      const lat = parseFloat(latParam)
      const lng = parseFloat(lngParam)
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return NextResponse.json({ success: false, error: "Invalid coordinates" }, { status: 400 })
      }
      const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      if (key) {
        try {
          const g = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${key}`)
          const gd = await g.json()
          if (gd.status === "OK" && gd.results?.length > 0) {
            return NextResponse.json({ success: true, data: { formattedAddress: gd.results[0].formatted_address, source: "google" } })
          }
        } catch (e) {
          console.error("Google reverse geocode error:", e)
        }
      }
      try {
        const n = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
          { headers: { "User-Agent": "Togethr-Family-App/1.0" } }
        )
        if (n.ok) {
          const nd = await n.json()
          if (nd?.display_name) {
            return NextResponse.json({ success: true, data: { formattedAddress: nd.display_name, source: "nominatim" } })
          }
        }
      } catch (e) {
        console.error("Nominatim reverse error:", e)
      }
      return NextResponse.json({ success: false, error: "No address found for that location" }, { status: 404 })
    }

    const address = request.nextUrl.searchParams.get("address")?.trim()
    if (!address) {
      return NextResponse.json(
        { success: false, error: "Address is required" },
        { status: 400 }
      )
    }

    const googleKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

    if (googleKey) {
      try {
        const googleRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`
        )
        const googleData = await googleRes.json()
        if (googleData.status === "OK" && googleData.results?.length > 0) {
          const result = googleData.results[0]
          return NextResponse.json({
            success: true,
            data: {
              latitude: result.geometry.location.lat,
              longitude: result.geometry.location.lng,
              formattedAddress: result.formatted_address,
              source: "google",
            },
          })
        }
      } catch (e) {
        console.error("Google geocode error, falling back to Nominatim:", e)
      }
    }

    // Fallback: OpenStreetMap Nominatim (no key required)
    const nominatimRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "User-Agent": "Togethr-Family-App/1.0" } }
    )

    if (!nominatimRes.ok) {
      return NextResponse.json(
        { success: false, error: "Could not look up that address right now" },
        { status: 502 }
      )
    }

    const results = await nominatimRes.json()
    if (!Array.isArray(results) || results.length === 0) {
      return NextResponse.json(
        { success: false, error: "Couldn't find that address. Try being more specific, or use 'Use my current location' instead." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        latitude: parseFloat(results[0].lat),
        longitude: parseFloat(results[0].lon),
        formattedAddress: results[0].display_name,
        source: "nominatim",
      },
    })
  } catch (error) {
    console.error("Geocode error:", error)
    return NextResponse.json(
      { success: false, error: "Failed to look up address" },
      { status: 500 }
    )
  }
}
