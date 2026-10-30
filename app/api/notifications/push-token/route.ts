import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyAccessToken } from '@/lib/auth'
import { registerPushToken, unregisterPushToken } from '@/lib/services/push'

export async function POST(request: Request) {
  try {
    // Authenticate user
    const authHeader = request.headers.get('Authorization')
    let accessToken: string | undefined

    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7)
    }

    if (!accessToken) {
      const cookieStore = await cookies()
      accessToken = cookieStore.get('access_token')?.value
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(accessToken)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { token, platform } = body

    if (!token || !platform) {
      return NextResponse.json(
        { error: 'Token and platform are required' },
        { status: 400 }
      )
    }

    if (!['web', 'ios', 'android'].includes(platform)) {
      return NextResponse.json(
        { error: 'Invalid platform. Must be web, ios, or android' },
        { status: 400 }
      )
    }

    // A short label for the admin test-push list, e.g. "Chrome on Windows".
    const info = body.deviceInfo && typeof body.deviceInfo === 'object' ? body.deviceInfo : {}
    const deviceInfo: Record<string, string> = {}
    if (typeof info.browser === 'string') deviceInfo.browser = info.browser.slice(0, 60)
    if (typeof info.language === 'string') deviceInfo.language = info.language.slice(0, 20)
    // This browser's own random id (hooks/use-push-notifications.ts).
    if (typeof info.deviceId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(info.deviceId)) deviceInfo.deviceId = info.deviceId

    const success = await registerPushToken(payload.userId, token, platform, deviceInfo)

    if (!success) {
      return NextResponse.json(
        { error: 'Failed to register push token' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Push token registration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    // SECURITY FIX: this previously had no auth check at all — anyone who
    // knew or guessed a token value could unregister another user's device.
    const authHeader = request.headers.get('Authorization')
    let accessToken: string | undefined

    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7)
    }

    if (!accessToken) {
      const cookieStore = await cookies()
      accessToken = cookieStore.get('access_token')?.value
    }

    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = await verifyAccessToken(accessToken)
    if (!payload?.userId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const body = await request.json()
    const { token } = body

    if (!token) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      )
    }

    const success = await unregisterPushToken(token, payload.userId)

    return NextResponse.json({ success })
  } catch (error) {
    console.error('Push token unregistration error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
