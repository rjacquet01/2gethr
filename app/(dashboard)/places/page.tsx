'use client'

import { useState } from 'react'
import { useFamilies } from '@/hooks/use-family'
import { useSubscription } from '@/hooks/use-subscription'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import {
  MapPin,
  Plus,
  Home,
  Building,
  GraduationCap,
  ShoppingBag,
  Heart,
  Trash2,
  Edit,
  Bell,
  BellOff,
  Crown,
  Star,
  Locate,
  Search,
  CheckCircle2,
  Smartphone,
  Mail,
  MessageSquare,
} from 'lucide-react'
import { useFavorites } from '@/components/favorites-dropdown'
import useSWR from 'swr'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ColorPicker, IconPicker, getPlaceIcon } from '@/components/customization'

interface SavedPlace {
  id: string
  familyId: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  radius: number
  geofenceEnabled: boolean
  alertOnArrival: boolean
  alertOnDeparture: boolean
  icon: string | null
  color: string
  notifyChannels: NotifyChannel[] | null
  createdAt: string
}

// Mirrors NotificationChannel in lib/notifications.ts and the same picker
// already on reminders (app/(dashboard)/dashboard/reminders/page.tsx), tasks
// and events - which channel fires a geofence arrival/departure alert for
// this place. Null/unset (the default) falls back to "use the recipient's
// own notification settings", matching how a place created before this
// column existed behaves.
type NotifyChannel = 'in_app' | 'push' | 'email' | 'sms'

const NOTIFY_CHANNEL_OPTIONS: { value: NotifyChannel; label: string; icon: typeof Bell }[] = [
  { value: 'in_app', label: 'In-app', icon: Bell },
  { value: 'push', label: 'Push', icon: Smartphone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'sms', label: 'Text', icon: MessageSquare },
]

const DEFAULT_NOTIFY_CHANNELS: NotifyChannel[] = ['in_app', 'push', 'email']

const fetcher = async (url: string) => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  const data = await res.json()
  return data.data
}

export default function PlacesPage() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  const { access, isLoading: subscriptionLoading } = useSubscription(primaryFamily?.id || null)
  
  const { data: places, isLoading: placesLoading, mutate } = useSWR<SavedPlace[]>(
    primaryFamily?.id ? `/api/places?familyId=${primaryFamily.id}` : null,
    fetcher
  )
  const { isFavorite, toggleFavorite } = useFavorites()

  const [addPlaceOpen, setAddPlaceOpen] = useState(false)
  const [editPlaceOpen, setEditPlaceOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null)
  const [newPlace, setNewPlace] = useState({
    name: '',
    address: '',
    latitude: null as number | null,
    longitude: null as number | null,
    locationLabel: '',
    radius: 100,
    geofenceEnabled: false,
    alertOnArrival: true,
    alertOnDeparture: true,
    icon: 'default',
    color: '#3B82F6',
    notifyChannels: DEFAULT_NOTIFY_CHANNELS as NotifyChannel[],
  })
  const [editPlace, setEditPlace] = useState({
    name: '',
    address: '',
    latitude: null as number | null,
    longitude: null as number | null,
    locationLabel: '',
    radius: 100,
    geofenceEnabled: false,
    alertOnArrival: true,
    alertOnDeparture: true,
    icon: 'default',
    color: '#3B82F6',
    notifyChannels: DEFAULT_NOTIFY_CHANNELS as NotifyChannel[],
  })

  const toggleNotifyChannel = (channel: NotifyChannel, target: 'new' | 'edit') => {
    const update = (channels: NotifyChannel[]) =>
      channels.includes(channel) ? channels.filter((c) => c !== channel) : [...channels, channel]
    if (target === 'new') setNewPlace((p) => ({ ...p, notifyChannels: update(p.notifyChannels) }))
    else setEditPlace((p) => ({ ...p, notifyChannels: update(p.notifyChannels) }))
  }

  const geocodeAddress = async (address: string, target: 'new' | 'edit') => {
    if (!address.trim()) {
      toast.error('Enter an address first')
      return
    }
    setIsLocating(true)
    try {
      const res = await authFetch(`/api/places/geocode?address=${encodeURIComponent(address)}`, {
        credentials: 'include',
      })
      const data = await res.json()
      if (data.success) {
        const update = {
          latitude: data.data.latitude,
          longitude: data.data.longitude,
          locationLabel: `Found: ${data.data.formattedAddress}`,
        }
        if (target === 'new') setNewPlace((p) => ({ ...p, ...update }))
        else setEditPlace((p) => ({ ...p, ...update }))
        toast.success('Location found')
      } else {
        toast.error(data.error || 'Could not find that address')
      }
    } catch {
      toast.error('Could not look up that address')
    }
    setIsLocating(false)
  }

  const useCurrentLocation = (target: 'new' | 'edit') => {
    if (!navigator.geolocation) {
      toast.error('Your browser does not support location access')
      return
    }
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        const update = {
          latitude: lat,
          longitude: lng,
          locationLabel: `Using your current location (±${Math.round(position.coords.accuracy)}m accuracy)`,
        }
        if (target === 'new') setNewPlace((p) => ({ ...p, ...update }))
        else setEditPlace((p) => ({ ...p, ...update }))
        toast.success('Current location set')
        // Fill the address box from the coordinates (only if it's empty)
        try {
          const res = await authFetch(`/api/places/geocode?lat=${lat}&lng=${lng}`, { credentials: 'include' })
          const data = await res.json()
          if (data.success && data.data?.formattedAddress) {
            const addr: string = data.data.formattedAddress
            if (target === 'new') setNewPlace((p) => (p.address ? p : { ...p, address: addr }))
            else setEditPlace((p) => (p.address ? p : { ...p, address: addr }))
          }
        } catch {
          // address lookup is best-effort; coordinates are already set
        }
        setIsLocating(false)
      },
      (err) => {
        setIsLocating(false)
        toast.error(err.message || 'Could not get your current location')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleAddPlace = async () => {
    if (!newPlace.name.trim()) {
      toast.error('Please enter a place name')
      return
    }

    if (!primaryFamily?.id) {
      toast.error('No family selected')
      return
    }

    if (newPlace.latitude === null || newPlace.longitude === null) {
      toast.error('Set this place\'s location first — search the address or use your current location')
      return
    }

    setIsAdding(true)
    try {
      const res = await authFetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          familyId: primaryFamily.id,
          name: newPlace.name,
          address: newPlace.address || null,
          latitude: newPlace.latitude,
          longitude: newPlace.longitude,
          radius: newPlace.radius,
          geofenceEnabled: newPlace.geofenceEnabled,
          alertOnArrival: newPlace.alertOnArrival,
          alertOnDeparture: newPlace.alertOnDeparture,
          icon: newPlace.icon,
          color: newPlace.color,
          notifyChannels: newPlace.notifyChannels,
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success('Place saved successfully!')
        setAddPlaceOpen(false)
        setNewPlace({
          name: '',
          address: '',
          latitude: null,
          longitude: null,
          locationLabel: '',
          radius: 100,
          geofenceEnabled: false,
          alertOnArrival: true,
          alertOnDeparture: true,
          icon: 'default',
          color: '#3B82F6',
          notifyChannels: DEFAULT_NOTIFY_CHANNELS,
        })
        mutate()
      } else {
        toast.error(data.error || 'Failed to save place')
      }
    } catch {
      toast.error('Failed to save place')
    }
    setIsAdding(false)
  }

  const openEditDialog = (place: SavedPlace) => {
    setEditingPlace(place)
    setEditPlace({
      name: place.name,
      address: place.address || '',
      latitude: place.latitude,
      longitude: place.longitude,
      locationLabel: `Current: ${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`,
      radius: place.radius,
      geofenceEnabled: place.geofenceEnabled,
      alertOnArrival: place.alertOnArrival,
      alertOnDeparture: place.alertOnDeparture,
      icon: place.icon || 'default',
      color: place.color,
      notifyChannels:
        place.notifyChannels && place.notifyChannels.length > 0
          ? place.notifyChannels
          : DEFAULT_NOTIFY_CHANNELS,
    })
    setEditPlaceOpen(true)
  }

  const handleUpdatePlace = async () => {
    if (!editingPlace || !editPlace.name.trim()) {
      toast.error('Please enter a place name')
      return
    }

    setIsEditing(true)
    try {
      const res = await authFetch(`/api/places/${editingPlace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: editPlace.name,
          address: editPlace.address || null,
          ...(editPlace.latitude !== null ? { latitude: editPlace.latitude } : {}),
          ...(editPlace.longitude !== null ? { longitude: editPlace.longitude } : {}),
          radius: editPlace.radius,
          geofenceEnabled: editPlace.geofenceEnabled,
          alertOnArrival: editPlace.alertOnArrival,
          alertOnDeparture: editPlace.alertOnDeparture,
          icon: editPlace.icon,
          color: editPlace.color,
          notifyChannels: editPlace.notifyChannels,
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success('Place updated successfully!')
        setEditPlaceOpen(false)
        setEditingPlace(null)
        mutate()
      } else {
        toast.error(data.error || 'Failed to update place')
      }
    } catch {
      toast.error('Failed to update place')
    }
    setIsEditing(false)
  }

  const handleDeletePlace = async (placeId: string) => {
    if (!confirm('Are you sure you want to delete this place?')) return

    try {
      const res = await authFetch(`/api/places/${placeId}`, {
        method: 'DELETE',
        credentials: 'include',
      })

      if (res.ok) {
        toast.success('Place deleted')
        mutate()
      } else {
        toast.error('Failed to delete place')
      }
    } catch {
      toast.error('Failed to delete place')
    }
  }

  const isLoading = familiesLoading || placesLoading || subscriptionLoading

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    )
  }

  if (!primaryFamily) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Empty
          title="No family yet"
          description="Create or join a family to save places"
        />
        <Button asChild className="mt-6">
          <Link href="/onboarding">Get Started</Link>
        </Button>
      </div>
    )
  }

  const maxPlaces = access.limits.maxSavedPlaces
  const currentCount = places?.length || 0
  const canAddMore = currentCount < maxPlaces

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Saved Places</h1>
          <p className="text-muted-foreground">
            Manage family locations and geofence alerts
          </p>
        </div>
        <Dialog open={addPlaceOpen} onOpenChange={setAddPlaceOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAddMore}>
              <Plus className="w-4 h-4 mr-2" />
              Add Place
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Place</DialogTitle>
              <DialogDescription>
                Save a location for quick access and optional geofence alerts
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="placeName">Place Name</Label>
                <Input
                  id="placeName"
                  placeholder="e.g., Home, School, Grandma's House"
                  value={newPlace.name}
                  onChange={(e) => setNewPlace({ ...newPlace, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="placeAddress">Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="placeAddress"
                    placeholder="123 Main St, City, State"
                    value={newPlace.address}
                    onChange={(e) => setNewPlace({ ...newPlace, address: e.target.value, locationLabel: '' })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isLocating}
                    onClick={() => geocodeAddress(newPlace.address, 'new')}
                    title="Find this address"
                  >
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={isLocating}
                  onClick={() => useCurrentLocation('new')}
                >
                  <Locate className="w-3.5 h-3.5 mr-1" />
                  Use my current location instead
                </Button>
                {newPlace.locationLabel && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {newPlace.locationLabel}
                  </p>
                )}
                {!newPlace.locationLabel && (
                  <p className="text-xs text-muted-foreground">
                    A geofence needs a real location — search the address above or use your current location.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <IconPicker
                  value={newPlace.icon}
                  color={newPlace.color}
                  onChange={(key) => setNewPlace({ ...newPlace, icon: key })}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <ColorPicker
                  value={newPlace.color}
                  onChange={(color) => setNewPlace({ ...newPlace, color })}
                />
              </div>
              {access.hasPremium && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="geofence">Enable Geofence</Label>
                      <p className="text-xs text-muted-foreground">
                        Get alerts when family members arrive or leave
                      </p>
                    </div>
                    <Switch
                      id="geofence"
                      checked={newPlace.geofenceEnabled}
                      onCheckedChange={(checked) =>
                        setNewPlace({ ...newPlace, geofenceEnabled: checked })
                      }
                    />
                  </div>
                  {newPlace.geofenceEnabled && (
                    <div className="pl-4 border-l-2 border-muted space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="arrival">Alert on Arrival</Label>
                        <Switch
                          id="arrival"
                          checked={newPlace.alertOnArrival}
                          onCheckedChange={(checked) =>
                            setNewPlace({ ...newPlace, alertOnArrival: checked })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="departure">Alert on Departure</Label>
                        <Switch
                          id="departure"
                          checked={newPlace.alertOnDeparture}
                          onCheckedChange={(checked) =>
                            setNewPlace({ ...newPlace, alertOnDeparture: checked })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="radius">Radius: {newPlace.radius}m</Label>
                        <Input
                          id="radius"
                          type="range"
                          min={50}
                          max={500}
                          step={25}
                          value={newPlace.radius}
                          onChange={(e) =>
                            setNewPlace({ ...newPlace, radius: parseInt(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Notify me via</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {NOTIFY_CHANNEL_OPTIONS.map(({ value, label, icon: Icon }) => {
                            const selected = newPlace.notifyChannels.includes(value)
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => toggleNotifyChannel(value, 'new')}
                                aria-pressed={selected}
                                className={cn(
                                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                                  selected
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                                )}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        {newPlace.notifyChannels.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Pick at least one way to hear about arrivals and departures here, or it won&apos;t notify you at all.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!access.hasPremium && (
                <div className="p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Crown className="w-4 h-4 text-amber-500" />
                    Geofencing requires Premium
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upgrade to get arrival and departure alerts
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddPlaceOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddPlace} disabled={isAdding || newPlace.latitude === null}>
                {isAdding ? <Spinner className="w-4 h-4 mr-2" /> : null}
                Save Place
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Place Dialog */}
        <Dialog open={editPlaceOpen} onOpenChange={setEditPlaceOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Place</DialogTitle>
              <DialogDescription>
                Update the details for this saved location
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="editPlaceName">Place Name</Label>
                <Input
                  id="editPlaceName"
                  placeholder="e.g., Home, School, Grandma's House"
                  value={editPlace.name}
                  onChange={(e) => setEditPlace({ ...editPlace, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editPlaceAddress">Address</Label>
                <div className="flex gap-2">
                  <Input
                    id="editPlaceAddress"
                    placeholder="123 Main St, City, State"
                    value={editPlace.address}
                    onChange={(e) => setEditPlace({ ...editPlace, address: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={isLocating}
                    onClick={() => geocodeAddress(editPlace.address, 'edit')}
                    title="Find this address"
                  >
                    <Search className="w-4 h-4" />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={isLocating}
                  onClick={() => useCurrentLocation('edit')}
                >
                  <Locate className="w-3.5 h-3.5 mr-1" />
                  Use my current location instead
                </Button>
                {editPlace.locationLabel && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {editPlace.locationLabel}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Icon</Label>
                <IconPicker
                  value={editPlace.icon}
                  color={editPlace.color}
                  onChange={(key) => setEditPlace({ ...editPlace, icon: key })}
                />
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <ColorPicker
                  value={editPlace.color}
                  onChange={(color) => setEditPlace({ ...editPlace, color })}
                />
              </div>
              {access.hasPremium && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="editGeofence">Enable Geofence</Label>
                      <p className="text-xs text-muted-foreground">
                        Get alerts when family members arrive or leave
                      </p>
                    </div>
                    <Switch
                      id="editGeofence"
                      checked={editPlace.geofenceEnabled}
                      onCheckedChange={(checked) =>
                        setEditPlace({ ...editPlace, geofenceEnabled: checked })
                      }
                    />
                  </div>
                  {editPlace.geofenceEnabled && (
                    <div className="pl-4 border-l-2 border-muted space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="editArrival">Alert on Arrival</Label>
                        <Switch
                          id="editArrival"
                          checked={editPlace.alertOnArrival}
                          onCheckedChange={(checked) =>
                            setEditPlace({ ...editPlace, alertOnArrival: checked })
                          }
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="editDeparture">Alert on Departure</Label>
                        <Switch
                          id="editDeparture"
                          checked={editPlace.alertOnDeparture}
                          onCheckedChange={(checked) =>
                            setEditPlace({ ...editPlace, alertOnDeparture: checked })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="editRadius">Radius: {editPlace.radius}m</Label>
                        <Input
                          id="editRadius"
                          type="range"
                          min={50}
                          max={500}
                          step={25}
                          value={editPlace.radius}
                          onChange={(e) =>
                            setEditPlace({ ...editPlace, radius: parseInt(e.target.value) })
                          }
                          className="w-full"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Notify me via</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {NOTIFY_CHANNEL_OPTIONS.map(({ value, label, icon: Icon }) => {
                            const selected = editPlace.notifyChannels.includes(value)
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => toggleNotifyChannel(value, 'edit')}
                                aria-pressed={selected}
                                className={cn(
                                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
                                  selected
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border text-muted-foreground hover:border-muted-foreground/40'
                                )}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        {editPlace.notifyChannels.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Pick at least one way to hear about arrivals and departures here, or it won&apos;t notify you at all.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              {!access.hasPremium && (
                <div className="p-3 rounded-lg bg-muted">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Crown className="w-4 h-4 text-amber-500" />
                    Geofencing requires Premium
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upgrade to get arrival and departure alerts
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPlaceOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdatePlace} disabled={isEditing}>
                {isEditing ? <Spinner className="w-4 h-4 mr-2" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Usage Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Saved Places</p>
              <p className="text-2xl font-bold">
                {currentCount} <span className="text-muted-foreground text-lg font-normal">/ {maxPlaces === Infinity ? 'Unlimited' : maxPlaces}</span>
              </p>
            </div>
            {!canAddMore && (
              <Badge variant="secondary">
                <Crown className="w-3 h-3 mr-1" />
                Upgrade for more
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Places Grid */}
      {places?.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <MapPin className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="font-medium text-foreground mb-1">No saved places yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add your frequently visited locations for quick access
              </p>
              <Button onClick={() => setAddPlaceOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Place
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {places?.map((place) => {
            const IconComponent = getPlaceIcon(place.icon)
            return (
              <Card key={place.id} className="overflow-hidden">
                <div
                  className="h-2"
                  style={{ backgroundColor: place.color }}
                />
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${place.color}20` }}
                      >
                        <IconComponent
                          className="w-5 h-5"
                          style={{ color: place.color }}
                        />
                      </div>
                      <div>
                        <CardTitle className="text-base">{place.name}</CardTitle>
                        {place.address && (
                          <CardDescription className="text-xs line-clamp-1">
                            {place.address}
                          </CardDescription>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => toggleFavorite('place', place.id)}
                      >
                        <Star 
                          className={`w-4 h-4 ${isFavorite('place', place.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} 
                        />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => openEditDialog(place)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDeletePlace(place.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 flex-wrap">
                    {place.geofenceEnabled ? (
                      <Badge variant="outline" className="text-xs">
                        <Bell className="w-3 h-3 mr-1" />
                        Geofence On
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <BellOff className="w-3 h-3 mr-1" />
                        Geofence Off
                      </Badge>
                    )}
                    {place.geofenceEnabled && (
                      <>
                        {place.alertOnArrival && (
                          <Badge variant="outline" className="text-xs text-green-600">
                            Arrival
                          </Badge>
                        )}
                        {place.alertOnDeparture && (
                          <Badge variant="outline" className="text-xs text-amber-600">
                            Departure
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                  {place.geofenceEnabled && (
                    <div className="flex items-center gap-1.5 mt-2">
                      {NOTIFY_CHANNEL_OPTIONS.filter((opt) =>
                        (place.notifyChannels && place.notifyChannels.length > 0
                          ? place.notifyChannels
                          : DEFAULT_NOTIFY_CHANNELS
                        ).includes(opt.value)
                      ).map(({ value, label, icon: Icon }) => (
                        <span
                          key={value}
                          title={label}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground"
                        >
                          <Icon className="w-3 h-3" />
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Radius: {place.radius}m
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
