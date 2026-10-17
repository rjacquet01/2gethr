'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useFamilies } from '@/hooks/use-family'
import { useMyRole } from '@/hooks/use-my-role'
import { GuestAreaNotice } from '@/components/guest-area-notice'
import { useSubscription } from '@/hooks/use-subscription'
import { authFetch } from '@/hooks/use-auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  MapPin, Navigation, RefreshCw, Clock, Battery,
  User, ExternalLink, Settings, Shield, Bell,
  Users, ChevronRight, Loader2, AlertCircle, Crown, Crosshair, Info
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SUBSCRIPTION_TIERS, centsToDisplay } from '@/lib/subscription-tiers'
import { BackgroundLocationCard } from '@/components/background-location-card'
import { TrackedMap } from '@/components/tracked-map'
import { SosButton } from '@/components/sos-button'
import { MemberAvatar } from '@/components/member-avatar'
import { cn } from '@/lib/utils'

// High-accuracy GPS often times out on laptops/desktops and indoors. Try it
// first, then fall back to a coarser (Wi-Fi/cell/IP) fix so sharing still works.
function getPositionWithFallback(
  onSuccess: PositionCallback,
  onError: PositionErrorCallback
) {
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError(err)
        return
      }
      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 5 * 60 * 1000,
      })
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  )
}

interface FamilyMemberLocation {
  memberId: string
  userId: string
  name: string
  role: string
  color?: string | null
  emoji?: string | null
  profilePhotoPath: string | null
  locationMode: string
  location: {
    latitude: number
    longitude: number
    accuracy: number | null
    altitude: number | null
    speed: number | null
    heading: number | null
    batteryLevel: number | null
    timestamp: string
  } | null
}

interface PingableMember {
  memberId: string
  name: string
  role: string
}

interface LocationSnapshot {
  requestId: string
  name: string
  latitude: number
  longitude: number
  accuracy: number | null
  at: string
}

interface LocationSettings {
  id: string
  memberId: string
  familyId: string
  mode: 'OFF' | 'ACTIVE' | 'PAUSED'
  shareWithFamily: boolean
  updateIntervalSec: number
}

/** This phone's battery as a whole percent, or null where the browser doesn't expose it. */
async function currentBatteryLevel(): Promise<number | null> {
  try {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery
    const b = getBattery ? await getBattery.call(navigator) : null
    return b ? Math.round(b.level * 100) : null
  } catch {
    return null
  }
}

// Guests don't get family location: show a notice instead of mounting the
// page (whose hooks would call the location APIs).
export default function LocationPage() {
  const { isGuest, isLoading } = useMyRole()
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }
  if (isGuest) return <GuestAreaNotice />
  return <LocationPageContent />
}

function LocationPageContent() {
  const { families, isLoading: familiesLoading } = useFamilies()
  // Use the first family as the selected family (primary family)
  const selectedFamily = families[0] || null
  const { access, isLoading: subscriptionLoading } = useSubscription(selectedFamily?.id || null)
  const [locations, setLocations] = useState<FamilyMemberLocation[]>([])
  const [pingable, setPingable] = useState<PingableMember[]>([])
  const [snapshots, setSnapshots] = useState<LocationSnapshot[]>([])
  const [mySettings, setMySettings] = useState<LocationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState(false)
  const [selectedMember, setSelectedMember] = useState<FamilyMemberLocation | null>(null)
  const [showMapDialog, setShowMapDialog] = useState(false)
  const [mapFocusId, setMapFocusId] = useState<string | null>(null)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [updatingSettings, setUpdatingSettings] = useState(false)
  const [requestingLocation, setRequestingLocation] = useState<string | null>(null)
  // Location pings other parents sent me that I still need to approve or deny.
  const [approvals, setApprovals] = useState<{ id: string; requesterName: string; expiresAt: string }[]>([])
  const [answeringApproval, setAnsweringApproval] = useState<string | null>(null)

  const loadApprovals = useCallback(async () => {
    try {
      const r = await authFetch('/api/location/request?awaiting=1')
      if (!r.ok) return
      const j = await r.json()
      if (Array.isArray(j?.data)) setApprovals(j.data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadApprovals()
    const t = setInterval(() => {
      if (!document.hidden) loadApprovals()
    }, 15_000)
    return () => clearInterval(t)
  }, [loadApprovals])

  const answerApproval = async (id: string, action: 'approve' | 'deny') => {
    setAnsweringApproval(id)
    try {
      let fix: { latitude: number; longitude: number; accuracy: number | null } | null = null
      if (action === 'approve') {
        // Approving shares ONE snapshot of where you are right now.
        fix = await new Promise((resolve) => {
          if (!navigator.geolocation) return resolve(null)
          getPositionWithFallback(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy ?? null }),
            () => resolve(null)
          )
        })
        if (!fix) {
          toast.error('Allow location access for Togethr on this device to approve - the request is still open.')
          return
        }
      }
      const res = await authFetch(`/api/location/request/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fix ? { action, ...fix } : { action }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(action === 'approve' ? 'Approved - your location was shared once' : 'Request declined')
      } else {
        toast.error(data.error || 'Could not answer the request')
      }
    } catch {
      toast.error('Could not answer the request')
    } finally {
      setAnsweringApproval(null)
      loadApprovals()
    }
  }
  // How often THIS viewer's screen auto-refreshes everyone's location/geofence
  // status (distinct from mySettings.updateIntervalSec, which controls how
  // often a member with ACTIVE mode PUBLISHES their own location). Previously
  // hardcoded to 30s with no way to tighten it - e.g. to keep a closer eye on
  // a kid's geofence arrival/departure status. Stored per-browser since it's
  // a viewing preference, not something that needs to sync across devices.
  const [viewRefreshIntervalSec, setViewRefreshIntervalSec] = useState(30)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('location-view-refresh-interval-sec')
      if (saved) setViewRefreshIntervalSec(parseInt(saved, 10))
    } catch {
      // localStorage unavailable (private browsing, etc.) - just keep the default
    }
  }, [])

  const handleViewRefreshIntervalChange = (value: string) => {
    const seconds = parseInt(value, 10)
    setViewRefreshIntervalSec(seconds)
    try {
      localStorage.setItem('location-view-refresh-interval-sec', String(seconds))
    } catch {
      // ignore
    }
  }

  const loadLocations = useCallback(async () => {
    if (!selectedFamily?.id) return

    try {
      const res = await authFetch(`/api/location?familyId=${selectedFamily.id}`)

      const data = await res.json()
      if (res.ok) {
        setLocations(data.data || [])
        setPingable(Array.isArray(data.pingable) ? data.pingable : [])
        setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : [])
        setSubscriptionError(false)
      } else if (data.code === 'SUBSCRIPTION_REQUIRED') {
        setSubscriptionError(true)
        setLocations([])
      }
    } catch (error) {
      console.error('Failed to load locations:', error)
    }
  }, [selectedFamily?.id, access?.tier])

  const loadMySettings = useCallback(async () => {
    if (!selectedFamily?.id) return

    try {
      // API returns settings for all families user is in
      const res = await authFetch('/api/location/settings')

      if (res.ok) {
        const data = await res.json()
        // Find settings for current family
        const allSettings = Array.isArray(data.data) ? data.data : []
        const familySettings = allSettings.find((s: { familyId: string }) => s.familyId === selectedFamily.id)
        if (familySettings) {
          setMySettings({
            id: familySettings.id || '',
            memberId: familySettings.memberId,
            familyId: familySettings.familyId,
            mode: familySettings.mode || 'OFF',
            shareWithFamily: familySettings.shareWithFamily ?? false,
            updateIntervalSec: familySettings.updateIntervalSec || 300,
          })
        } else if (allSettings.length > 0) {
          // Use first available member settings as fallback
          const firstSettings = allSettings[0]
          setMySettings({
            id: firstSettings.id || '',
            memberId: firstSettings.memberId,
            familyId: firstSettings.familyId,
            mode: firstSettings.mode || 'OFF',
            shareWithFamily: firstSettings.shareWithFamily ?? false,
            updateIntervalSec: firstSettings.updateIntervalSec || 300,
          })
        } else {
          setMySettings(null)
        }
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, [selectedFamily?.id])

  // Request location from a family member (parent feature)
  const requestLocationNow = async (memberId: string, memberName: string) => {
    if (!selectedFamily?.id) return

    setRequestingLocation(memberId)
    try {
      const res = await authFetch('/api/location/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: selectedFamily.id,
          memberId,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success(data?.data?.status === 'AWAITING_APPROVAL'
          ? `Asked ${memberName} to approve - you'll be notified when they respond`
          : `Location request sent to ${memberName}`)
      } else {
        toast.error(data.error || 'Failed to request location')
      }
    } catch (error) {
      toast.error('Failed to send location request')
    } finally {
      setRequestingLocation(null)
    }
  }


  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        await Promise.all([loadLocations(), loadMySettings()])
      } catch (error) {
        console.error('Failed to load location data:', error)
      } finally {
        setLoading(false)
      }
    }

    if (selectedFamily?.id) {
      load()
    } else if (!familiesLoading) {
      // No family selected and not loading - stop loading state
      setLoading(false)
    }
  }, [selectedFamily?.id, loadLocations, loadMySettings, familiesLoading])

  // Auto-refresh locations (and geofence arrival/departure status) at the
  // viewer's chosen interval when the page is visible.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden && selectedFamily?.id) {
        loadLocations()
      }
    }, viewRefreshIntervalSec * 1000)

    return () => clearInterval(interval)
  }, [selectedFamily?.id, loadLocations, viewRefreshIntervalSec])

  // Live location tracking - continuously share location when mode is ACTIVE
  useEffect(() => {
    if (!mySettings || mySettings.mode !== 'ACTIVE' || !mySettings.shareWithFamily || !navigator.geolocation) {
      return
    }

    const userIntervalMs = (mySettings.updateIntervalSec || 60) * 1000
    const MIN_GAP_MS = 10_000 // never send faster than this
    const MOVE_SEND_METERS = 50 // also report promptly after real movement

    let suggestedMs: number | null = null // server hint: shorten near a geofence
    let lastSentAt = 0
    let lastSent: { lat: number; lng: number } | null = null
    let sending = false

    // Battery level goes with each ping (parents see it and get a low-battery
    // heads-up). Below 20% and not charging, report at most every 5 minutes so
    // sharing doesn't drain a nearly flat phone. Browsers without the Battery
    // Status API (Safari, Firefox) just send no level and keep the normal pace.
    const LOW_BATTERY_LEVEL = 0.2
    const LOW_BATTERY_INTERVAL_MS = 5 * 60_000
    type BatteryLike = EventTarget & { level: number; charging: boolean }
    let battery: { level: number; charging: boolean } | null = null
    let batteryManager: BatteryLike | null = null
    const readBattery = () => {
      if (batteryManager) battery = { level: batteryManager.level, charging: batteryManager.charging }
    }
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery
    getBattery?.call(navigator)
      .then((b) => {
        batteryManager = b
        readBattery()
        b.addEventListener('levelchange', readBattery)
        b.addEventListener('chargingchange', readBattery)
      })
      .catch(() => {})
    const lowBattery = () => !!battery && !battery.charging && battery.level < LOW_BATTERY_LEVEL

    const effectiveIntervalMs = () =>
      lowBattery()
        ? Math.max(LOW_BATTERY_INTERVAL_MS, userIntervalMs)
        : Math.max(MIN_GAP_MS, suggestedMs ? Math.min(userIntervalMs, suggestedMs) : userIntervalMs)

    const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371e3
      const p1 = (a.lat * Math.PI) / 180
      const p2 = (b.lat * Math.PI) / 180
      const dp = ((b.lat - a.lat) * Math.PI) / 180
      const dl = ((b.lng - a.lng) * Math.PI) / 180
      const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
      return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
    }

    const sendLocation = async (position: GeolocationPosition, force = false) => {
      const now = Date.now()
      const here = { lat: position.coords.latitude, lng: position.coords.longitude }
      const sinceLast = now - lastSentAt
      const moved = lastSent ? metersBetween(lastSent, here) : Infinity
      const due = sinceLast >= effectiveIntervalMs() - 1000
      // On low battery, movement doesn't trigger extra reports either.
      const movedEnough = moved >= MOVE_SEND_METERS && sinceLast >= (lowBattery() ? LOW_BATTERY_INTERVAL_MS : MIN_GAP_MS)
      if (sending || !(force || due || movedEnough)) return
      sending = true
      lastSentAt = now
      lastSent = here
      try {
        const res = await authFetch('/api/location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy ?? null,
            altitude: position.coords.altitude ?? null,
            speed: position.coords.speed ?? null,
            heading: position.coords.heading ?? null,
            batteryLevel: battery ? Math.round(battery.level * 100) : null,
            memberId: mySettings.memberId,
            familyId: mySettings.familyId,
          }),
        })
        const json = await res.json().catch(() => null)
        const hint = json?.data?.suggestedIntervalSec
        suggestedMs = typeof hint === 'number' && hint > 0 ? hint * 1000 : null
      } catch (error) {
        // Silent fail for live tracking
      } finally {
        sending = false
      }
    }

    const poll = (force = false) =>
      getPositionWithFallback((pos) => sendLocation(pos, force), () => {})

    // Initial fix right away.
    poll(true)

    // Movement-driven updates (throttled in sendLocation).
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        sendLocation(position)
      },
      () => {
        // Geolocation errors are handled silently for continuous tracking
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )

    // Heartbeat so a stationary device still reports on schedule (watchPosition
    // only fires when the position changes), at the adaptive interval.
    let heartbeat: ReturnType<typeof setTimeout>
    const schedule = () => {
      heartbeat = setTimeout(() => {
        if (!document.hidden) poll()
        schedule()
      }, Math.min(effectiveIntervalMs(), 30_000))
    }
    schedule()

    // A parent tapped "Request location": answer within ~20s instead of
    // waiting out the sharing interval.
    const requestWatch = setInterval(async () => {
      if (document.hidden) return
      try {
        const r = await authFetch('/api/location/request')
        if (!r.ok) return
        const j = await r.json()
        if (Array.isArray(j?.data) && j.data.length > 0) poll(true)
      } catch {
        // ignore
      }
    }, 20_000)

    // Coming back to the app after being backgrounded: report immediately
    // instead of waiting out the interval.
    const onVisible = () => {
      if (!document.hidden) poll(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.geolocation.clearWatch(watchId)
      clearTimeout(heartbeat)
      clearInterval(requestWatch)
      document.removeEventListener('visibilitychange', onVisible)
      batteryManager?.removeEventListener('levelchange', readBattery)
      batteryManager?.removeEventListener('chargingchange', readBattery)
    }
  }, [mySettings?.mode, mySettings?.updateIntervalSec, mySettings?.shareWithFamily, mySettings?.memberId, mySettings?.familyId])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadLocations()
    setRefreshing(false)
    toast.success('Locations refreshed')
  }

  const handlePingLocation = async () => {
    // Request current device location and share it
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser')
      return
    }

    // Guard: wait for settings to be loaded
    if (!mySettings?.memberId || !mySettings?.familyId) {
      toast.error('Please wait for settings to load')
      return
    }

    const { memberId, familyId } = mySettings

    toast.promise(
      new Promise((resolve, reject) => {
        getPositionWithFallback(
          async (position) => {
            try {
              const res = await authFetch('/api/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracy: position.coords.accuracy ?? null,
                  altitude: position.coords.altitude ?? null,
                  speed: position.coords.speed ?? null,
                  heading: position.coords.heading ?? null,
                  batteryLevel: await currentBatteryLevel(),
                  memberId,
                  familyId,
                }),
              })

              if (res.ok) {
                await loadLocations()
                resolve('Location shared successfully')
              } else {
                const data = await res.json()
                reject(new Error(data.error || 'Failed to share location'))
              }
            } catch (error) {
              reject(error)
            }
          },
          (error) => {
            reject(new Error(
              error.code === error.PERMISSION_DENIED
                ? 'Location permission is blocked. Allow location for this site in your browser or phone settings.'
                : 'Could not get your location. Check that location services are on and try again.'
            ))
          }
        )
      }),
      {
        loading: 'Getting your location...',
        success: 'Location shared with family',
        error: (err) => err.message || 'Failed to share location',
      }
    )
  }

  const handleUpdateSettings = async (updates: Partial<LocationSettings>) => {
    if (!selectedFamily?.id || !mySettings?.memberId) {
      toast.error("Unable to update settings - please refresh the page")
      return
    }

    setUpdatingSettings(true)
    try {
      // Send updates directly - mode is already in correct format (OFF/ACTIVE/PAUSED)
      const res = await authFetch('/api/location/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: mySettings.memberId, ...updates }),
      })

      if (res.ok) {
        await loadMySettings() // Reload to get fresh data
        toast.success('Settings updated')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update settings')
      }
    } catch (error) {
      toast.error('Failed to update settings')
    } finally {
      setUpdatingSettings(false)
    }
  }

  const openInMaps = (lat: number, lng: number, name: string) => {
    // Detect platform and open appropriate maps app
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isAndroid = /Android/.test(navigator.userAgent)

    if (isIOS) {
      // Apple Maps
      window.open(`maps://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${lat},${lng}`, '_blank')
    } else if (isAndroid) {
      // Google Maps on Android
      window.open(`geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(name)})`, '_blank')
    } else {
      // Google Maps web fallback
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`, '_blank')
    }
  }

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} min ago`
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hours ago`
    return date.toLocaleDateString()
  }

  const getModeColor = (mode: string) => {
    switch (mode) {
      case 'ACTIVE': return 'bg-green-500'
      case 'PAUSED': return 'bg-yellow-500'
      case 'OFF': return 'bg-muted'
      default: return 'bg-muted'
    }
  }

  // A member's locationMode of 'ACTIVE' only means their sharing SETTING is
  // turned on - it says nothing about whether we've actually heard from
  // their device recently. The per-member badge used to show the raw mode
  // (ACTIVE/PAUSED/OFF) regardless of how old the last ping was, so a family
  // member whose phone hadn't reported in days still showed a plain green
  // "Active" badge - misleading for a feature parents rely on for safety.
  // These two helpers fold "is the mode ACTIVE" and "is the data actually
  // fresh" into one status so the badge reflects what's really going on.
  const STALE_LOCATION_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

  const getMemberLocationStatus = (member: FamilyMemberLocation): { label: string; colorClass: string } => {
    if (member.locationMode !== 'ACTIVE') {
      return {
        label: member.locationMode === 'OFF' ? 'Off' : 'Paused',
        colorClass: getModeColor(member.locationMode),
      }
    }
    if (!member.location) {
      return { label: 'Active · No Data Yet', colorClass: 'bg-amber-500' }
    }
    const ageMs = Date.now() - new Date(member.location.timestamp).getTime()
    if (ageMs > STALE_LOCATION_THRESHOLD_MS) {
      return { label: 'Active · Stale', colorClass: 'bg-amber-500' }
    }
    return { label: 'Active', colorClass: 'bg-green-500' }
  }

  // Only show loading if we're actually loading data (not if familyId is missing)
  const isActuallyLoading = familiesLoading || (selectedFamily?.id && (loading || subscriptionLoading))

  if (isActuallyLoading) {
    return (
      <div>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    )
  }

  if (!selectedFamily) {
    return (
      <div>
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-medium">No Family Selected</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Please select or create a family to use location features.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show upgrade prompt if subscription doesn't include location sharing
  // Only show upgrade prompt if we have subscription data AND user is not on Premium
  const hasLocationAccess = !!access?.featureFlags.locationSharing

  if (subscriptionError || (access && !hasLocationAccess)) {
    return (
      <div>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Family Location</h1>
            <p className="text-muted-foreground">
              Track and share locations with your family members
            </p>
          </div>

          <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardContent className="py-12 text-center">
              <Crown className="mx-auto h-12 w-12 text-amber-500" />
              <h3 className="mt-4 text-lg font-medium">Premium Feature</h3>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                Real-time location sharing is available exclusively with our Premium plan (${centsToDisplay(SUBSCRIPTION_TIERS.PREMIUM_PLUS.priceMonthlyCents)}/month).
                Upgrade to track your family members&apos; locations, set up geofence alerts, and keep everyone safe.
              </p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                <Button asChild>
                  <Link href="/subscription/upgrade?tier=PREMIUM_PLUS">
                    <Crown className="mr-2 h-4 w-4" />
                    Upgrade to Premium
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/subscription">
                    View Plans
                  </Link>
                </Button>
              </div>
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left max-w-lg mx-auto">
                <div className="flex items-start gap-2">
                  <MapPin className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Real-time Tracking</p>
                    <p className="text-xs text-muted-foreground">See locations live</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Bell className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Geofence Alerts</p>
                    <p className="text-xs text-muted-foreground">Arrival/departure alerts</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Shield className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Family Safety</p>
                    <p className="text-xs text-muted-foreground">Peace of mind</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }
  const sharingMembers = locations.filter((l) => l.location)
  const staleCount = locations.filter((l) => getMemberLocationStatus(l).label.includes('Stale')).length
  const notSharing = pingable.filter((p) => !locations.some((l) => l.memberId === p.memberId))
  const iAmSharing = mySettings?.mode === 'ACTIVE' && !!mySettings.shareWithFamily
  const focusName = locations.find((l) => l.memberId === mapFocusId)?.name

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Family Location</h1>
          <p className="truncate text-sm text-muted-foreground">
            {sharingMembers.length} sharing
            {staleCount > 0 && <> · {staleCount} not updating</>}
            {notSharing.length > 0 && <> · {notSharing.length} not sharing</>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh locations">
            <RefreshCw className={`h-4 w-4 sm:mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettingsDialog(true)} aria-label="Location settings">
            <Settings className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
        </div>
      </div>

      {/* Pings waiting on my approval */}
      {approvals.map((a) => (
        <Card key={a.id} className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">{a.requesterName} wants to see your current location</p>
              <p className="text-sm text-muted-foreground">Your location is shared once, only if you approve.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={answeringApproval === a.id} onClick={() => answerApproval(a.id, 'approve')}>
                Approve
              </Button>
              <Button size="sm" variant="outline" disabled={answeringApproval === a.id} onClick={() => answerApproval(a.id, 'deny')}>
                Deny
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* My sharing status */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div className="flex items-center gap-3">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', mySettings ? getModeColor(mySettings.mode) : 'bg-muted')} />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {iAmSharing
                  ? "You're sharing your location"
                  : mySettings?.mode === 'PAUSED'
                    ? 'Your sharing is paused'
                    : 'Your sharing is off'}
              </p>
              <p className="text-xs text-muted-foreground">
                {iAmSharing
                  ? 'Family can see where you are.'
                  : 'Turn it on so family can see you, or share just once.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SosButton familyId={selectedFamily?.id} />
            <Button size="sm" onClick={handlePingLocation}>
              <Navigation className="mr-1.5 h-4 w-4" />
              Share now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                handleUpdateSettings({
                  mode: mySettings?.mode === 'OFF' ? 'ACTIVE' : 'OFF',
                  shareWithFamily: mySettings?.mode === 'OFF' ? true : false,
                })
              }
              disabled={updatingSettings}
            >
              {mySettings?.mode === 'OFF' ? 'Turn on' : 'Turn off'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Map + people */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="space-y-2 lg:sticky lg:top-4">
            {sharingMembers.length > 0 ? (
              <>
                {mapFocusId && (
                  <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 text-sm">
                    <span>
                      Following <span className="font-medium">{focusName}</span>
                    </span>
                    <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setMapFocusId(null)}>
                      Show everyone
                    </Button>
                  </div>
                )}
                <TrackedMap
                  members={locations}
                  familyId={selectedFamily?.id}
                  focusMemberId={mapFocusId}
                  allowTrail={!!mapFocusId}
                  className="h-72 sm:h-96 lg:h-[32rem]"
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex h-64 flex-col items-center justify-center text-center">
                  <MapPin className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">No locations to display</p>
                  <p className="text-sm text-muted-foreground">Family members need to share their location first</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {/* One-time locations people approved for me */}
          {snapshots.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">Shared with you once</h2>
              {snapshots.map((sn) => (
                <div key={sn.requestId} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{sn.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(sn.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      {sn.accuracy ? ` (±${Math.round(sn.accuracy)}m)` : ''} · gone in an hour
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`https://www.google.com/maps?q=${sn.latitude},${sn.longitude}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3 w-3" />
                      Map
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* People sharing */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">
              People <span className="font-normal text-muted-foreground">{locations.length}</span>
            </h2>
            {locations.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <MapPin className="mx-auto h-10 w-10 text-muted-foreground" />
                  <p className="mt-3 font-medium">No locations available</p>
                  <p className="mt-1 text-sm text-muted-foreground">Family members need to enable location sharing to appear here.</p>
                </CardContent>
              </Card>
            ) : (
              locations.map((member) => {
                const status = getMemberLocationStatus(member)
                const focused = mapFocusId === member.memberId
                const isMe = member.memberId === mySettings?.memberId
                return (
                  <div
                    key={member.memberId}
                    className={cn('rounded-lg border bg-card transition-colors', focused && 'border-primary bg-primary/5')}
                  >
                    <div className="flex items-center gap-2 p-3">
                      <button
                        type="button"
                        disabled={!member.location}
                        onClick={() => setMapFocusId(focused ? null : member.memberId)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                        aria-label={member.location ? `Show ${member.name} on the map` : member.name}
                      >
                        <MemberAvatar name={member.name} avatarUrl={member.profilePhotoPath} color={member.color} emoji={member.emoji} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {member.name}
                            {isMe && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}
                          </p>
                          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                            <span className={cn('h-2 w-2 shrink-0 rounded-full', status.colorClass)} />
                            <span>{status.label}</span>
                            {member.location && (
                              <>
                                <span>·</span>
                                <span>{formatTimestamp(member.location.timestamp)}</span>
                                {member.location.batteryLevel !== null && (
                                  <>
                                    <span>·</span>
                                    <Battery className="h-3 w-3" />
                                    <span>{member.location.batteryLevel}%</span>
                                  </>
                                )}
                              </>
                            )}
                          </p>
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {/* Ping: anyone can ask anyone for a one-time location; they must approve */}
                        {!isMe && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            disabled={requestingLocation === member.memberId}
                            onClick={() => requestLocationNow(member.memberId, member.name)}
                            title="Request current location"
                            aria-label={`Ping ${member.name}`}
                          >
                            {requestingLocation === member.memberId ? <Spinner className="h-3 w-3" /> : <Crosshair className="h-4 w-4" />}
                          </Button>
                        )}
                        {member.location && (
                          <>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              title="Details"
                              aria-label={`${member.name} details`}
                              onClick={() => {
                                setSelectedMember(member)
                                setShowMapDialog(true)
                              }}
                            >
                              <Info className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-8 w-8"
                              title="Open in Maps"
                              aria-label={`Open ${member.name} in Maps`}
                              onClick={() => openInMaps(member.location!.latitude, member.location!.longitude, member.name)}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Ask someone who isn't sharing for a one-time location */}
          {notSharing.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">
                Not sharing <span className="font-normal text-muted-foreground">{notSharing.length}</span>
              </h2>
              {notSharing.map((p) => (
                <div key={p.memberId} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <MemberAvatar name={p.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">They must approve before anything is shared</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    disabled={requestingLocation === p.memberId}
                    onClick={() => requestLocationNow(p.memberId, p.name)}
                  >
                    {requestingLocation === p.memberId ? (
                      <Spinner className="h-3 w-3" />
                    ) : (
                      <>
                        <Crosshair className="mr-1 h-3 w-3" />
                        Ask
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Privacy tips */}
      <details className="group rounded-lg border bg-muted/40 px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium">
          <Shield className="h-4 w-4 text-muted-foreground" />
          Privacy &amp; safety tips
        </summary>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          <li>Location sharing is only visible to family members with permission</li>
          <li>You can pause or disable sharing at any time from settings</li>
          <li>Use the &quot;Share now&quot; button to manually send your current location</li>
        </ul>
      </details>

      {/* Map Dialog for Individual Member */}
      {/* Map Dialog for Individual Member */}
      <Dialog open={showMapDialog} onOpenChange={setShowMapDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedMember?.name}&apos;s Location</DialogTitle>
            <DialogDescription>
              {selectedMember?.location && formatTimestamp(selectedMember.location.timestamp)}
            </DialogDescription>
          </DialogHeader>

          {selectedMember?.location && (
            <div className="space-y-4">
              <TrackedMap
                members={locations}
                familyId={selectedFamily?.id}
                focusMemberId={selectedMember.memberId}
                className="h-[300px]"
              />

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Coordinates</p>
                  <p className="font-mono text-xs">
                    {selectedMember.location.latitude.toFixed(6)}, {selectedMember.location.longitude.toFixed(6)}
                  </p>
                </div>
                {selectedMember.location.accuracy && (
                  <div>
                    <p className="text-muted-foreground">Accuracy</p>
                    <p>±{Math.round(selectedMember.location.accuracy)} meters</p>
                  </div>
                )}
                {selectedMember.location.speed !== null && (
                  <div>
                    <p className="text-muted-foreground">Speed</p>
                    <p>{Math.round(selectedMember.location.speed * 3.6)} km/h</p>
                  </div>
                )}
                {selectedMember.location.batteryLevel !== null && (
                  <div>
                    <p className="text-muted-foreground">Battery</p>
                    <p>{selectedMember.location.batteryLevel}%</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMapDialog(false)}>
              Close
            </Button>
            {selectedMember?.location && (
              <Button onClick={() => openInMaps(
                selectedMember.location!.latitude,
                selectedMember.location!.longitude,
                selectedMember.name
              )}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Open in Maps App
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Location Settings</DialogTitle>
            <DialogDescription>
              Configure how you share your location with family members
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Share Location with Family</Label>
                <p className="text-sm text-muted-foreground">
                  Allow family members to see your location
                </p>
              </div>
              <Switch
                checked={mySettings?.shareWithFamily ?? false}
                onCheckedChange={(checked) => handleUpdateSettings({ shareWithFamily: checked })}
                disabled={updatingSettings}
              />
            </div>

            <div className="space-y-3">
              <Label>Sharing Mode</Label>
              <div className="grid gap-2">
                {[
                  { mode: 'ACTIVE', label: 'Active', desc: 'Continuously share your location' },
                  { mode: 'PAUSED', label: 'Paused', desc: 'Temporarily stop sharing' },
                  { mode: 'OFF', label: 'Off', desc: 'Location sharing disabled' },
                ].map((option) => (
                  <button
                    key={option.mode}
                    className={`flex items-center justify-between p-3 rounded-lg border text-left transition-colors ${
                      mySettings?.mode === option.mode
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => handleUpdateSettings({ mode: option.mode as LocationSettings['mode'] })}
                    disabled={updatingSettings}
                  >
                    <div>
                      <p className="font-medium">{option.label}</p>
                      <p className="text-sm text-muted-foreground">{option.desc}</p>
                    </div>
                    {mySettings?.mode === option.mode && (
                      <Badge variant="secondary" className={`${getModeColor(option.mode)} text-white`}>
                        Active
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <BackgroundLocationCard
              memberId={mySettings?.memberId}
              familyId={mySettings?.familyId}
              intervalSec={mySettings?.updateIntervalSec || 300}
            />

            <div className="space-y-3">
              <Label>Update Frequency</Label>
              <p className="text-sm text-muted-foreground">
                How often your location is shared when active
              </p>
              <Select
                value={String(mySettings?.updateIntervalSec || 300)}
                onValueChange={(value) => handleUpdateSettings({ updateIntervalSec: parseInt(value) })}
                disabled={updatingSettings}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">Every 30 seconds (High accuracy)</SelectItem>
                  <SelectItem value="60">Every 1 minute</SelectItem>
                  <SelectItem value="120">Every 2 minutes</SelectItem>
                  <SelectItem value="300">Every 5 minutes (Recommended)</SelectItem>
                  <SelectItem value="600">Every 10 minutes</SelectItem>
                  <SelectItem value="900">Every 15 minutes (Battery saver)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Higher frequency uses more battery. Recommended: 5 minutes.
              </p>
            </div>

            <div className="space-y-3">
              <Label>Screen Refresh Interval</Label>
              <p className="text-sm text-muted-foreground">
                How often this screen auto-refreshes family locations and geofence status (e.g. arrival/departure alerts for kids)
              </p>
              <Select
                value={String(viewRefreshIntervalSec)}
                onValueChange={handleViewRefreshIntervalChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select refresh interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">Every 10 seconds</SelectItem>
                  <SelectItem value="30">Every 30 seconds (Default)</SelectItem>
                  <SelectItem value="60">Every 1 minute</SelectItem>
                  <SelectItem value="120">Every 2 minutes</SelectItem>
                  <SelectItem value="300">Every 5 minutes</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Only affects this device/browser - it doesn&apos;t change how often anyone&apos;s location is shared.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowSettingsDialog(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
