'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useFamilies } from '@/hooks/use-family'
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
  Users, ChevronRight, Loader2, AlertCircle, Crown, Crosshair
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SUBSCRIPTION_TIERS, centsToDisplay } from '@/lib/subscription-tiers'
import { BackgroundLocationCard } from '@/components/background-location-card'

interface FamilyMemberLocation {
  memberId: string
  userId: string
  name: string
  role: string
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

interface LocationSettings {
  id: string
  memberId: string
  familyId: string
  mode: 'OFF' | 'ACTIVE' | 'PAUSED'
  shareWithFamily: boolean
  updateIntervalSec: number
}

export default function LocationPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  // Use the first family as the selected family (primary family)
  const selectedFamily = families[0] || null
  const { access, isLoading: subscriptionLoading } = useSubscription(selectedFamily?.id || null)
  const [locations, setLocations] = useState<FamilyMemberLocation[]>([])
  const [mySettings, setMySettings] = useState<LocationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [subscriptionError, setSubscriptionError] = useState(false)
  const [selectedMember, setSelectedMember] = useState<FamilyMemberLocation | null>(null)
  const [showMapDialog, setShowMapDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [updatingSettings, setUpdatingSettings] = useState(false)
  const [requestingLocation, setRequestingLocation] = useState<string | null>(null)
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
        toast.success(`Location request sent to ${memberName}`)
        // Refresh locations after a short delay to show updated data
        setTimeout(() => loadLocations(), 2000)
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

    const effectiveIntervalMs = () =>
      Math.max(MIN_GAP_MS, suggestedMs ? Math.min(userIntervalMs, suggestedMs) : userIntervalMs)

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
      const movedEnough = moved >= MOVE_SEND_METERS && sinceLast >= MIN_GAP_MS
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
      navigator.geolocation.getCurrentPosition((pos) => sendLocation(pos, force), () => {}, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      })

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

    // Coming back to the app after being backgrounded: report immediately
    // instead of waiting out the interval.
    const onVisible = () => {
      if (!document.hidden) poll(true)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      navigator.geolocation.clearWatch(watchId)
      clearTimeout(heartbeat)
      document.removeEventListener('visibilitychange', onVisible)
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
        navigator.geolocation.getCurrentPosition(
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
            reject(new Error(error.message))
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
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
      <div className="container max-w-4xl py-8">
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      </div>
    )
  }

  if (!selectedFamily) {
    return (
      <div className="container max-w-4xl py-8">
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
      <div className="container max-w-4xl py-8">
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

  return (
    <div className="container max-w-4xl py-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Family Location</h1>
            <p className="text-muted-foreground">
              Track and share locations with your family members
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowSettingsDialog(true)}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
          </div>
        </div>

        {/* My Location Sharing Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">My Location Sharing</CardTitle>
              {mySettings && (
                <Badge variant="secondary" className={`${getModeColor(mySettings.mode)} text-white`}>
                  {mySettings.mode === 'OFF' ? 'Off' : mySettings.mode === 'ACTIVE' ? 'Active' : 'Paused'}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button onClick={handlePingLocation} className="flex-1">
                <Navigation className="mr-2 h-4 w-4" />
                Share My Current Location
              </Button>
              <Button
                variant="outline"
                onClick={() => handleUpdateSettings({
                  mode: mySettings?.mode === 'OFF' ? 'ACTIVE' : 'OFF',
                  shareWithFamily: mySettings?.mode === 'OFF' ? true : false
                })}
                disabled={updatingSettings}
              >
                {mySettings?.mode === 'OFF' ? 'Enable Location Sharing' : 'Disable Location Sharing'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Family Members */}
        <Tabs defaultValue="list" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="list">List View</TabsTrigger>
            <TabsTrigger value="map">Map View</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            {locations.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <MapPin className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-medium">No Locations Available</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Family members need to enable location sharing to appear here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              locations.map((member) => {
                const status = getMemberLocationStatus(member)
                return (
                <Card key={member.memberId} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          <User className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{member.name}</span>
                            <Badge variant="outline" className="text-xs">{member.role}</Badge>
                          </div>
                          {member.location ? (
                            <>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Clock className="h-3 w-3" />
                                <span>{formatTimestamp(member.location.timestamp)}</span>
                                {member.location.batteryLevel !== null && (
                                  <>
                                    <Battery className="ml-2 h-3 w-3" />
                                    <span>{member.location.batteryLevel}%</span>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {member.location.latitude.toFixed(6)}, {member.location.longitude.toFixed(6)}
                                {member.location.accuracy && ` (±${Math.round(member.location.accuracy)}m)`}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">No recent location</p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 items-end">
                        <Badge variant="secondary" className={`${status.colorClass} text-white text-xs`}>
                          {status.label}
                        </Badge>
                        <div className="flex gap-1 flex-wrap justify-end">
                          {/* Request Location Now button - for parents/guardians to ping others */}
                          {selectedFamily?.currentUserRole &&
                           ['ADMIN', 'PARENT', 'GUARDIAN'].includes(selectedFamily.currentUserRole) &&
                           member.memberId !== mySettings?.memberId && (
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 text-xs"
                              disabled={requestingLocation === member.memberId}
                              onClick={() => requestLocationNow(member.memberId, member.name)}
                              title="Request current location"
                            >
                              {requestingLocation === member.memberId ? (
                                <Spinner className="h-3 w-3" />
                              ) : (
                                <>
                                  <Crosshair className="h-3 w-3 mr-1" />
                                  Ping
                                </>
                              )}
                            </Button>
                          )}
                          {member.location && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => {
                                  setSelectedMember(member)
                                  setShowMapDialog(true)
                                }}
                              >
                                <MapPin className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => openInMaps(
                                  member.location!.latitude,
                                  member.location!.longitude,
                                  member.name
                                )}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                )
              })
            )}
          </TabsContent>

          <TabsContent value="map">
            <Card>
              <CardContent className="p-0">
                <div className="relative h-[400px] w-full bg-muted rounded-lg overflow-hidden">
                  {locations.filter(l => l.location).length > 0 ? (
                    <iframe
                      title="Family Location Map"
                      className="absolute inset-0 w-full h-full border-0"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&q=${
                        locations.filter(l => l.location).map(l =>
                          `${l.location!.latitude},${l.location!.longitude}`
                        ).join('|')
                      }&center=${
                        locations.filter(l => l.location)[0]?.location?.latitude || 0
                      },${
                        locations.filter(l => l.location)[0]?.location?.longitude || 0
                      }&zoom=14`}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full">
                      <MapPin className="h-12 w-12 text-muted-foreground" />
                      <p className="mt-4 text-muted-foreground">No locations to display</p>
                      <p className="text-sm text-muted-foreground">
                        Family members need to share their location first
                      </p>
                    </div>
                  )}

                  {/* Static map fallback if no API key */}
                  {!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && locations.filter(l => l.location).length > 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted">
                      <MapPin className="h-12 w-12 text-primary" />
                      <p className="mt-4 font-medium">Map View</p>
                      <p className="text-sm text-muted-foreground text-center px-4">
                        {locations.filter(l => l.location).length} family member(s) sharing location
                      </p>
                      <div className="mt-4 space-y-2">
                        {locations.filter(l => l.location).map(member => (
                          <Button
                            key={member.memberId}
                            variant="outline"
                            size="sm"
                            onClick={() => openInMaps(
                              member.location!.latitude,
                              member.location!.longitude,
                              member.name
                            )}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Open {member.name} in Maps
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Location Tips */}
        <Card className="bg-muted/50">
          <CardContent className="py-4">
            <div className="flex gap-3">
              <Shield className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Privacy & Safety Tips</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>Location sharing is only visible to family members with permission</li>
                  <li>You can pause or disable sharing at any time from settings</li>
                  <li>Use the &quot;Share Location&quot; button to manually send your current location</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
              <div className="relative h-[300px] w-full bg-muted rounded-lg overflow-hidden">
                {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
                  <iframe
                    title={`${selectedMember.name}'s location`}
                    className="absolute inset-0 w-full h-full border-0"
                    loading="lazy"
                    src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&q=${selectedMember.location.latitude},${selectedMember.location.longitude}&zoom=16`}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full">
                    <MapPin className="h-12 w-12 text-primary" />
                    <p className="mt-4 font-medium">
                      {selectedMember.location.latitude.toFixed(6)}, {selectedMember.location.longitude.toFixed(6)}
                    </p>
                    {selectedMember.location.accuracy && (
                      <p className="text-sm text-muted-foreground">
                        Accuracy: ±{Math.round(selectedMember.location.accuracy)} meters
                      </p>
                    )}
                  </div>
                )}
              </div>

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
