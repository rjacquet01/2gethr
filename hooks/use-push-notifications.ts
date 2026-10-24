'use client'

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/hooks/use-auth'

interface PushNotificationState {
  isSupported: boolean
  isSubscribed: boolean
  isLoading: boolean
  permission: NotificationPermission | null
  error: string | null
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: true,
    permission: null,
    error: null
  })

  useEffect(() => {
    checkSupport()
  }, [])

  const checkSupport = async () => {
    // Check if browser supports push notifications
    const isSupported = 
      'serviceWorker' in navigator && 
      'PushManager' in window && 
      'Notification' in window

    if (!isSupported) {
      setState(prev => ({
        ...prev,
        isSupported: false,
        isLoading: false,
        error: 'Push notifications not supported in this browser'
      }))
      return
    }

    try {
      const permission = Notification.permission
      
      // Subscribed in this browser AND switched on for this account: the
      // browser's subscription may belong to whoever turned push on before.
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      const isSubscribed = subscription ? await isActiveForThisAccount(subscription) : false

      setState({
        isSupported: true,
        isSubscribed,
        isLoading: false,
        permission,
        error: null
      })
    } catch (error) {
      setState(prev => ({
        ...prev,
        isSupported: true,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check subscription status'
      }))
    }
  }

  const subscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // Request permission
      const permission = await Notification.requestPermission()
      
      if (permission !== 'granted') {
        setState(prev => ({
          ...prev,
          isLoading: false,
          permission,
          error: 'Notification permission denied'
        }))
        return false
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready

      // Subscribe to push notifications
      // Note: In production, you'd get this key from your server/Firebase
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      
      let subscription: PushSubscription

      if (vapidPublicKey) {
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey)
        const opts = { userVisibleOnly: true, applicationServerKey }
        try {
          subscription = await registration.pushManager.subscribe(opts)
        } catch (e) {
          // A subscription made with an older server key blocks a new one
          // (InvalidStateError): drop it and subscribe again.
          const old = await registration.pushManager.getSubscription()
          if (!old) throw e
          await old.unsubscribe()
          subscription = await registration.pushManager.subscribe(opts)
        }
      } else {
        // Fallback for FCM - use Firebase messaging
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true
        })
      }

      // Send subscription to server
      const response = await authFetch('/api/notifications/push-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: JSON.stringify(subscription),
          platform: 'web',
          deviceInfo: {
            browser: browserLabel(navigator.userAgent),
            language: navigator.language
          }
        })
      })

      if (!response.ok) {
        throw new Error('Failed to register push token')
      }

      setState({
        isSupported: true,
        isSubscribed: true,
        isLoading: false,
        permission: 'granted',
        error: null
      })

      return true
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to subscribe'
      }))
      return false
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        // Read the token before unsubscribing invalidates the subscription.
        const token = JSON.stringify(subscription)
        await subscription.unsubscribe()

        // Notify server to remove token
        await authFetch('/api/notifications/push-token', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token })
        })
      }

      setState(prev => ({
        ...prev,
        isSubscribed: false,
        isLoading: false,
        error: null
      }))

      return true
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to unsubscribe'
      }))
      return false
    }
  }, [])

  return {
    ...state,
    subscribe,
    unsubscribe,
    refresh: checkSupport
  }
}

async function isActiveForThisAccount(subscription: PushSubscription): Promise<boolean> {
  try {
    const res = await authFetch('/api/notifications/push-token/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: JSON.stringify(subscription) }),
    })
    if (!res.ok) return false
    return (await res.json()).registered === true
  } catch {
    return false
  }
}

/** "Chrome on Windows" from a user agent, for the admin device list. */
function browserLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser'
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : ''
  return os ? `${browser} on ${os}` : browser
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
