import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { isPushTokenActiveFor } from '@/lib/services/push'

// Is this browser's push subscription switched on for the signed-in account?
// The browser keeps one subscription whoever is signed in, so "subscribed in
// this browser" alone doesn't mean this account gets notifications here.
// POST so the subscription never ends up in a URL or access log.
export async function POST(request: Request) {
  const { user } = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    return NextResponse.json({ registered: await isPushTokenActiveFor(token, user.id) })
  } catch (error) {
    console.error('Push token status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
