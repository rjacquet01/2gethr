'use client'

import { useEffect, useRef, useState } from 'react'
import { useFamilies } from '@/hooks/use-family'
import { useMyRole } from '@/hooks/use-my-role'
import { GuestAreaNotice } from '@/components/guest-area-notice'
import { useSubscription } from '@/hooks/use-subscription'
import { authFetch, useAuth } from '@/hooks/use-auth'
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
  ImagePlus,
  Navigation,
  Users,
} from 'lucide-react'
import { useFavorites } from '@/components/favorites-dropdown'
import useSWR from 'swr'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ColorPicker, IconPicker, getPlaceIcon } from '@/components/customization'
import { GeofenceActivityCard } from '@/components/geofence-activity'

// ---- Saved place photos ----
// Phone photos are big and serverless requests are limited to ~4.5MB, so shrink
// the picture in the browser first (the server re-processes it as well).
async function shrinkPlacePhoto(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')
  ctx.drawImage(bmp, 0, 0, w, h)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))), 'image/jpeg', 0.82)
  )
}

async function uploadPlacePhoto(placeId: string, file: File): Promise<boolean> {
  try {
    const blob = await shrinkPlacePhoto(file)
    const formData = new FormData()
    formData.append('file', blob, 'place.jpg')
    const res = await authFetch(`/api/places/${placeId}/photo`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    return res.ok
  } catch {
    return false
  }
}

async function deletePlacePhoto(placeId: string): Promise<boolean> {
  try {
    const res = await authFetch(`/api/places/${placeId}/photo`, { method: 'DELETE', credentials: 'include' })
    return res.ok
  } catch {
    return false
  }
}

function PlacePhotoField({
  currentPath,
  file,
  removed,
  onPick,
  onRemove,
}: {
  currentPath?: string | null
  file: File | null
  removed?: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const src = preview || (!removed && currentPath ? `/api/files?pathname=${encodeURIComponent(currentPath)}` : null)
  return (
    <div className="space-y-2">
      <Label>Photo (optional)</Label>
      <div className="flex items-center gap-3">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="w-16 h-16 rounded-lg object-cover border" />
        ) : (
          <div className="w-16 h-16 rounded-lg border border-dashed flex items-center justify-center text-muted-foreground">
            <ImagePlus className="w-5 h-5" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (!f.type.startsWith('image/')) {
                toast.error('Please choose an image file')
                return
              }
              if (f.size > 25 * 1024 * 1024) {
                toast.error('That photo is too large')
                return
              }
              onPick(f)
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {src ? 'Change photo' : 'Add photo'}
          </Button>
          {src && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remove photo
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Shown on the place card instead of the icon.</p>
    </div>
  )
}

// Address line for a place card. Uses the saved address; if there isn't one it
// looks it up from the coordinates, and falls back to the coordinates.
function PlaceAddress({ place }: { place: SavedPlace }) {
  const [resolved, setResolved] = useState<string | null>(null)
  useEffect(() => {
    if (place.address) return
    let cancelled = false
    authFetch(`/api/places/geocode?lat=${place.latitude}&lng=${place.longitude}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.success && d.data?.formattedAddress) setResolved(d.data.formattedAddress)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [place.address, place.latitude, place.longitude])
  const text =
    place.address ||
    resolved ||
    `${Number(place.latitude).toFixed(5)}, ${Number(place.longitude).toFixed(5)}`
  return (
    <p className="text-xs text-muted-foreground flex items-start gap-1 mt-0.5 break-words">
      <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
      <span className="line-clamp-2">{text}</span>
    </p>
  )
}

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
  photoPath?: string | null
  canManage?: boolean
  notifyChannels: NotifyChannel[] | null
  /** Kids this place applies to (managers see all; others only themselves). */
  assignedMemberIds?: string[]
  /** Limited to specific kids (true even when the viewer can't see which). */
  isAssigned?: boolean
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

type PlaceFilter = 'all' | 'geofence' | 'nogeofence' | 'favorites'

const fetcher = async (url: string) => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  const data = await res.json()
  return data.data
}

interface PlaceDraft {
  name: string
  address: string
  latitude: number | null
  longitude: number | null
  locationLabel: string
  radius: number
  geofenceEnabled: boolean
  alertOnArrival: boolean
  alertOnDeparture: boolean
  icon: string
  color: string
  notifyChannels: NotifyChannel[]
  assignedMemberIds: string[]
}

// One form for both "Add place" and "Edit place" (they used to be two copies).
function PlaceFormFields({
  idp,
  mode,
  draft,
  setDraft,
  isLocating,
  onFind,
  onUseCurrent,
  photo,
  hasPremium,
  canManageGeofence,
  kids,
}: {
  idp: string
  mode: 'new' | 'edit'
  draft: PlaceDraft
  setDraft: (updater: (d: PlaceDraft) => PlaceDraft) => void
  isLocating: boolean
  onFind: () => void
  onUseCurrent: () => void
  photo: {
    currentPath?: string | null
    file: File | null
    removed?: boolean
    onPick: (file: File) => void
    onRemove: () => void
  }
  hasPremium: boolean
  canManageGeofence: boolean
  kids: { id: string; name: string }[]
}) {
  const set = (patch: Partial<PlaceDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const toggleChannel = (channel: NotifyChannel) =>
    setDraft((d) => ({
      ...d,
      notifyChannels: d.notifyChannels.includes(channel)
        ? d.notifyChannels.filter((c) => c !== channel)
        : [...d.notifyChannels, channel],
    }))
  const toggleKid = (id: string) =>
    setDraft((d) => ({
      ...d,
      assignedMemberIds: d.assignedMemberIds.includes(id)
        ? d.assignedMemberIds.filter((k) => k !== id)
        : [...d.assignedMemberIds, id],
    }))
  const chip = (selected: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
      selected
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:border-muted-foreground/40'
    )

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor={`${idp}Name`}>Place Name</Label>
        <Input
          id={`${idp}Name`}
          placeholder="e.g., Home, School, Grandma's House"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idp}Address`}>Address</Label>
        <div className="flex gap-2">
          <Input
            id={`${idp}Address`}
            placeholder="123 Main St, City, State"
            value={draft.address}
            onChange={(e) => set(mode === 'new' ? { address: e.target.value, locationLabel: '' } : { address: e.target.value })}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isLocating}
            onClick={onFind}
            title="Find this address"
            aria-label="Find this address"
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
          onClick={onUseCurrent}
        >
          <Locate className="w-3.5 h-3.5 mr-1" />
          Use my current location instead
        </Button>
        {draft.locationLabel ? (
          <p className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {draft.locationLabel}
          </p>
        ) : mode === 'new' ? (
          <p className="text-xs text-muted-foreground">
            Type the address (we&apos;ll look it up when you save) or use your current location.
          </p>
        ) : null}
      </div>
      <PlacePhotoField
        currentPath={photo.currentPath}
        file={photo.file}
        removed={photo.removed}
        onPick={photo.onPick}
        onRemove={photo.onRemove}
      />
      <div className="space-y-2">
        <Label>Icon</Label>
        <IconPicker value={draft.icon} color={draft.color} onChange={(key) => set({ icon: key })} />
      </div>
      <div className="space-y-2">
        <Label>Color</Label>
        <ColorPicker value={draft.color} onChange={(color) => set({ color })} />
      </div>
      {hasPremium && canManageGeofence && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor={`${idp}Geofence`}>Enable Geofence</Label>
              <p className="text-xs text-muted-foreground">Get alerts when family members arrive or leave</p>
            </div>
            <Switch
              id={`${idp}Geofence`}
              checked={draft.geofenceEnabled}
              onCheckedChange={(checked) => set({ geofenceEnabled: checked })}
            />
          </div>
          {draft.geofenceEnabled && (
            <div className="pl-4 border-l-2 border-muted space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor={`${idp}Arrival`}>Alert on Arrival</Label>
                <Switch
                  id={`${idp}Arrival`}
                  checked={draft.alertOnArrival}
                  onCheckedChange={(checked) => set({ alertOnArrival: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor={`${idp}Departure`}>Alert on Departure</Label>
                <Switch
                  id={`${idp}Departure`}
                  checked={draft.alertOnDeparture}
                  onCheckedChange={(checked) => set({ alertOnDeparture: checked })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idp}Radius`}>Radius: {draft.radius}m</Label>
                <Input
                  id={`${idp}Radius`}
                  type="range"
                  min={50}
                  max={500}
                  step={25}
                  value={draft.radius}
                  onChange={(e) => set({ radius: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>
              {kids.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Applies to</Label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => set({ assignedMemberIds: [] })}
                      aria-pressed={draft.assignedMemberIds.length === 0}
                      className={chip(draft.assignedMemberIds.length === 0)}
                    >
                      <Users className="w-3.5 h-3.5" />
                      Everyone
                    </button>
                    {kids.map((kid) => (
                      <button
                        key={kid.id}
                        type="button"
                        onClick={() => toggleKid(kid.id)}
                        aria-pressed={draft.assignedMemberIds.includes(kid.id)}
                        className={chip(draft.assignedMemberIds.includes(kid.id))}
                      >
                        {kid.name}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {draft.assignedMemberIds.length === 0
                      ? 'Alerts for anyone in the family arriving or leaving.'
                      : 'Alerts only when the selected kids arrive or leave.'}
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notify me via</Label>
                <div className="flex flex-wrap gap-1.5">
                  {NOTIFY_CHANNEL_OPTIONS.map(({ value, label, icon: Icon }) => {
                    const selected = draft.notifyChannels.includes(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => toggleChannel(value)}
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
                {draft.notifyChannels.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Pick at least one way to hear about arrivals and departures here, or it won&apos;t notify you at all.
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {!hasPremium && canManageGeofence && (
        <div className="p-3 rounded-lg bg-muted">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Crown className="w-4 h-4 text-amber-500" />
            Geofencing requires Premium
          </div>
          <p className="text-xs text-muted-foreground mt-1">Upgrade to get arrival and departure alerts</p>
        </div>
      )}
    </div>
  )
}


// Guests don't get saved places: show a notice instead of mounting the page
// (whose hooks would call the places APIs).
export default function PlacesPage() {
  const { isGuest, isLoading } = useMyRole()
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }
  if (isGuest) return <GuestAreaNotice />
  return <PlacesPageContent />
}

function PlacesPageContent() {
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  const { user } = useAuth()
  // Geofence alerts watch every family member, so only parents/guardians/adults set them up
  // (matches the server's place managers).
  const canManageGeofence = !!primaryFamily?.members?.some(
    (m) => m.userId === user?.id && (m.role === 'PARENT' || m.role === 'GUARDIAN' || m.role === 'ADULT')
  )
  const { access, isLoading: subscriptionLoading } = useSubscription(primaryFamily?.id || null)
  // Kids a manager can limit a place to (active CHILD members of this family)
  const kids = (primaryFamily?.members ?? [])
    .filter((m) => m.role === 'CHILD' && m.isActive)
    .map((m) => ({ id: m.id, name: m.displayName }))
  const kidName = (id: string) => kids.find((k) => k.id === id)?.name
  
  const { data: places, isLoading: placesLoading, mutate } = useSWR<SavedPlace[]>(
    primaryFamily?.id ? `/api/places?familyId=${primaryFamily.id}` : null,
    fetcher
  )
  const { isFavorite, toggleFavorite } = useFavorites()

  const [addPlaceOpen, setAddPlaceOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PlaceFilter>('all')
  const [editPlaceOpen, setEditPlaceOpen] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [editingPlace, setEditingPlace] = useState<SavedPlace | null>(null)
  const [newPhoto, setNewPhoto] = useState<File | null>(null)
  const [editPhoto, setEditPhoto] = useState<File | null>(null)
  const [editRemovePhoto, setEditRemovePhoto] = useState(false)
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
    assignedMemberIds: [] as string[],
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
    assignedMemberIds: [] as string[],
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

  const fillCurrentLocation = (target: 'new' | 'edit') => {
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

    // If an address was typed but never looked up, look it up now instead of
    // making the person find and press the search button first.
    let lat = newPlace.latitude
    let lng = newPlace.longitude
    let addr = newPlace.address
    if ((lat === null || lng === null) && newPlace.address.trim()) {
      setIsAdding(true)
      try {
        const geoRes = await authFetch(`/api/places/geocode?address=${encodeURIComponent(newPlace.address)}`, {
          credentials: 'include',
        })
        const geo = await geoRes.json()
        if (geo.success && geo.data) {
          lat = geo.data.latitude
          lng = geo.data.longitude
          addr = geo.data.formattedAddress || addr
        }
      } catch {
        // handled below
      }
      setIsAdding(false)
    }

    if (lat === null || lng === null) {
      toast.error("We couldn't find that address. Enter a full address (street, city, state) or use your current location.")
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
          address: addr || null,
          latitude: lat,
          longitude: lng,
          radius: newPlace.radius,
          geofenceEnabled: newPlace.geofenceEnabled,
          alertOnArrival: newPlace.alertOnArrival,
          alertOnDeparture: newPlace.alertOnDeparture,
          icon: newPlace.icon,
          color: newPlace.color,
          notifyChannels: newPlace.notifyChannels,
          ...(canManageGeofence ? { assignedMemberIds: newPlace.assignedMemberIds } : {}),
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success('Place saved successfully!')
        if (newPhoto && data.data?.id) {
          const ok = await uploadPlacePhoto(data.data.id, newPhoto)
          if (!ok) toast.error('Place saved, but the photo could not be uploaded')
        }
        setNewPhoto(null)
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
          assignedMemberIds: [],
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
      // Kids removed from the family since can't be re-saved; drop them
      assignedMemberIds: (place.assignedMemberIds ?? []).filter((id) => kids.some((k) => k.id === id)),
    })
    setEditPhoto(null)
    setEditRemovePhoto(false)
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
          ...(canManageGeofence ? { assignedMemberIds: editPlace.assignedMemberIds } : {}),
        }),
      })

      const data = await res.json()

      if (data.success) {
        toast.success('Place updated successfully!')
        if (editingPlace) {
          if (editPhoto) {
            const ok = await uploadPlacePhoto(editingPlace.id, editPhoto)
            if (!ok) toast.error('Place updated, but the photo could not be uploaded')
          } else if (editRemovePhoto && editingPlace.photoPath) {
            await deletePlacePhoto(editingPlace.id)
          }
        }
        setEditPhoto(null)
        setEditRemovePhoto(false)
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

  const toggleGeofence = async (place: SavedPlace, enabled: boolean) => {
    // Optimistic: flip the switch now, roll back if the server says no
    mutate((prev) => prev?.map((p) => (p.id === place.id ? { ...p, geofenceEnabled: enabled } : p)), {
      revalidate: false,
    })
    try {
      const res = await authFetch(`/api/places/${place.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ geofenceEnabled: enabled }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not update alerts')
      toast.success(enabled ? `Alerts on for ${place.name}` : `Alerts off for ${place.name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update alerts')
      mutate()
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
  const geofenceTotal = places?.filter((p) => p.geofenceEnabled).length || 0
  const favoriteTotal = places?.filter((p) => isFavorite('place', p.id)).length || 0

  const q = search.trim().toLowerCase()
  const homeRe = /\b(home|house)\b/i
  const shown = (places || [])
    .filter((p) => {
      if (filter === 'geofence' && !p.geofenceEnabled) return false
      if (filter === 'nogeofence' && p.geofenceEnabled) return false
      if (filter === 'favorites' && !isFavorite('place', p.id)) return false
      if (q && !(p.name.toLowerCase().includes(q) || (p.address || '').toLowerCase().includes(q))) return false
      return true
    })
    .sort((a, b) => {
      const rank = (p: SavedPlace) => (homeRe.test(p.name) ? 0 : isFavorite('place', p.id) ? 1 : 2)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })

  const canToggleGeofence = access.hasPremium && canManageGeofence

  const filterDefs: Array<{ key: PlaceFilter; label: string; n: number }> = [
    { key: 'all', label: 'All', n: currentCount },
    { key: 'geofence', label: 'Alerts on', n: geofenceTotal },
    { key: 'nogeofence', label: 'Alerts off', n: currentCount - geofenceTotal },
    { key: 'favorites', label: 'Favorites', n: favoriteTotal },
  ]

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground sm:text-2xl">Saved Places</h1>
          <p className="truncate text-sm text-muted-foreground">
            {currentCount} of {maxPlaces === Infinity ? 'unlimited' : maxPlaces} places · {geofenceTotal} with geofence alerts
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!canAddMore && (
            <Button size="sm" variant="outline" asChild>
              <Link href="/subscription">
                <Crown className="mr-1.5 h-4 w-4 text-amber-500" />
                Upgrade
              </Link>
            </Button>
          )}
          <Button size="sm" disabled={!canAddMore} onClick={() => setAddPlaceOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Place
          </Button>
        </div>
      </div>

      {places && places.length > 0 && (
        <div className="space-y-3">
          {places.length >= 5 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search places"
                className="h-10 pl-9"
                aria-label="Search places"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {filterDefs.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                  filter === f.key ? 'border-primary bg-primary/10 font-medium' : 'hover:bg-muted'
                )}
              >
                {f.n} {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
          ) : shown.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-muted-foreground">No places match</p>
                <Button
                  variant="link"
                  onClick={() => {
                    setSearch('')
                    setFilter('all')
                  }}
                >
                  Clear search and filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((place) => {
                const IconComponent = getPlaceIcon(place.icon)
                const manage = place.canManage !== false
                const channels =
                  place.notifyChannels && place.notifyChannels.length > 0 ? place.notifyChannels : DEFAULT_NOTIFY_CHANNELS
                return (
                  <Card key={place.id} className="overflow-hidden gap-0 py-0">
                    <div className="h-1.5" style={{ backgroundColor: place.color }} />
                    <CardContent className="p-3 sm:p-4">
                      <div className="flex items-start gap-3">
                        {place.photoPath ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/files?pathname=${encodeURIComponent(place.photoPath)}`}
                            alt={place.name}
                            className="w-12 h-12 shrink-0 rounded-lg object-cover border-2"
                            style={{ borderColor: place.color }}
                          />
                        ) : (
                          <div className="shrink-0 p-2.5 rounded-lg" style={{ backgroundColor: `${place.color}20` }}>
                            <IconComponent className="w-5 h-5" style={{ color: place.color }} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{place.name}</p>
                          <PlaceAddress place={place} />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => toggleFavorite('place', place.id)}
                          aria-label={isFavorite('place', place.id) ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star
                            className={`w-4 h-4 ${isFavorite('place', place.id) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                          />
                        </Button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {place.geofenceEnabled ? (
                          <>
                            <Badge variant="outline" className="text-xs">
                              <Bell className="w-3 h-3 mr-1" />
                              Alerts on · {place.radius}m
                            </Badge>
                            {place.isAssigned && (
                              <Badge variant="outline" className="text-xs">
                                <Users className="w-3 h-3 mr-1" />
                                {canManageGeofence
                                  ? 'Only ' + (place.assignedMemberIds ?? []).map((id) => kidName(id) ?? 'removed member').join(', ')
                                  : (place.assignedMemberIds?.length ?? 0) > 0 ? 'Includes you' : 'Selected kids only'}
                              </Badge>
                            )}
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
                            {NOTIFY_CHANNEL_OPTIONS.filter((opt) => channels.includes(opt.value)).map(
                              ({ value, label, icon: Icon }) => (
                                <span
                                  key={value}
                                  title={label}
                                  className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-muted-foreground"
                                >
                                  <Icon className="w-3 h-3" />
                                </span>
                              )
                            )}
                          </>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <BellOff className="w-3 h-3 mr-1" />
                            Alerts off
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2">
                        {canToggleGeofence && manage ? (
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                            <Switch
                              checked={place.geofenceEnabled}
                              onCheckedChange={(checked) => toggleGeofence(place, checked)}
                              aria-label={`Geofence alerts for ${place.name}`}
                            />
                            Alerts
                          </label>
                        ) : (
                          <span />
                        )}
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" asChild>
                            <a
                              href={`https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Navigation className="mr-1 h-3.5 w-3.5" />
                              Directions
                            </a>
                          </Button>
                          {manage && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEditDialog(place)}
                                aria-label={`Edit ${place.name}`}
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => handleDeletePlace(place.id)}
                                aria-label={`Delete ${place.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {/* Last 24h of geofence arrivals/departures */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <GeofenceActivityCard
            familyId={primaryFamily.id}
            placeCount={currentCount}
            maxPlaces={maxPlaces}
            geofenceCount={geofenceTotal}
            canAddMore={canAddMore}
          />
        </div>
      </div>

      {/* Add Place Dialog */}
      <Dialog open={addPlaceOpen} onOpenChange={setAddPlaceOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Place</DialogTitle>
            <DialogDescription>Save a location for quick access and optional geofence alerts</DialogDescription>
          </DialogHeader>
          <PlaceFormFields
            idp="new"
            mode="new"
            draft={newPlace}
            setDraft={(fn) => setNewPlace((d) => fn(d))}
            isLocating={isLocating}
            onFind={() => geocodeAddress(newPlace.address, 'new')}
            onUseCurrent={() => fillCurrentLocation('new')}
            photo={{ file: newPhoto, onPick: setNewPhoto, onRemove: () => setNewPhoto(null) }}
            hasPremium={access.hasPremium}
            canManageGeofence={canManageGeofence}
            kids={kids}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddPlaceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddPlace} disabled={isAdding}>
              {isAdding ? <Spinner className="w-4 h-4 mr-2" /> : null}
              Save Place
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Place Dialog */}
      <Dialog open={editPlaceOpen} onOpenChange={setEditPlaceOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Place</DialogTitle>
            <DialogDescription>Update the details for this saved location</DialogDescription>
          </DialogHeader>
          <PlaceFormFields
            idp="edit"
            mode="edit"
            draft={editPlace}
            setDraft={(fn) => setEditPlace((d) => fn(d))}
            isLocating={isLocating}
            onFind={() => geocodeAddress(editPlace.address, 'edit')}
            onUseCurrent={() => fillCurrentLocation('edit')}
            photo={{
              currentPath: editingPlace?.photoPath,
              file: editPhoto,
              removed: editRemovePhoto,
              onPick: (f) => {
                setEditPhoto(f)
                setEditRemovePhoto(false)
              },
              onRemove: () => {
                setEditPhoto(null)
                setEditRemovePhoto(true)
              },
            }}
            hasPremium={access.hasPremium}
            canManageGeofence={canManageGeofence}
            kids={kids}
          />
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
  )
}
