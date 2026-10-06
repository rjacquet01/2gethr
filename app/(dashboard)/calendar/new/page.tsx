'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR, { mutate } from 'swr'
import { format, addHours } from 'date-fns'
import { Calendar as CalendarIcon, Clock, MapPin, Users, Tag, Eye, ArrowLeft, Loader2, Check, X, Bell, Star } from 'lucide-react'
import { toast } from 'sonner'

import { localDateTimeToISO, localStartOfDayToISO, localEndOfDayToISO } from '@/lib/datetime'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  NotificationChannelsPicker,
  type NotificationChannelValue,
} from '@/components/notification-channels-picker'
import { useAuth, authFetch } from '@/hooks/use-auth'
import { useFamilies, useFamily, FamilyMember, ChildProfile } from '@/hooks/use-family'

const EVENT_CATEGORIES = [
  { value: 'GENERAL', label: 'General', color: 'bg-gray-500' },
  { value: 'SCHOOL', label: 'School', color: 'bg-blue-500' },
  { value: 'SPORTS', label: 'Sports', color: 'bg-green-500' },
  { value: 'MEDICAL', label: 'Medical', color: 'bg-red-500' },
  { value: 'SOCIAL', label: 'Social', color: 'bg-purple-500' },
  { value: 'WORK', label: 'Work', color: 'bg-orange-500' },
  { value: 'TRAVEL', label: 'Travel', color: 'bg-cyan-500' },
  { value: 'OTHER', label: 'Other', color: 'bg-slate-500' },
]

const VISIBILITY_OPTIONS = [
  { value: 'FAMILY', label: 'Entire Family', description: 'All family members can see this event' },
  { value: 'SELECTED_MEMBERS', label: 'Selected Members', description: 'Only selected participants can see' },
  { value: 'PRIVATE', label: 'Private', description: 'Only you can see this event' },
]

const REMINDER_OPTIONS = [
  { value: 0, label: 'At time of event' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
]

// Next.js requires any component that calls useSearchParams() to be wrapped
// in a Suspense boundary, or the page fails to prerender at build time
// ("useSearchParams() should be wrapped in a suspense boundary").
export default function NewEventPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NewEventForm />
    </Suspense>
  )
}

function NewEventForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const dateParam = searchParams.get('date')
  const { user, isLoading: authLoading } = useAuth()
  const { families, isLoading: familiesLoading } = useFamilies()
  
  // Use date from URL param if provided and valid, otherwise use today
  const getInitialDate = (): Date => {
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      const parsed = new Date(dateParam + 'T12:00:00')
      if (!isNaN(parsed.getTime())) {
        return parsed
      }
    }
    return new Date()
  }
  const initialDate = getInitialDate()
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allDay, setAllDay] = useState(false)
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceRule, setRecurrenceRule] = useState('weekly')
  const [selectedReminders, setSelectedReminders] = useState<number[]>([15]) // Default: 15 min reminder
  const [notifyChannels, setNotifyChannels] = useState<NotificationChannelValue[]>([])
  const [selectedParticipants, setSelectedParticipants] = useState<Array<{ 
    type: 'member' | 'child'
    id: string
    userId?: string
    childProfileId?: string
    displayName: string
    avatarUrl: string | null
  }>>([])
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: format(initialDate, 'yyyy-MM-dd'),
    startTime: format(initialDate, 'HH:mm'),
    endDate: format(initialDate, 'yyyy-MM-dd'),
    endTime: format(addHours(initialDate, 1), 'HH:mm'),
    location: '',
    category: 'GENERAL',
    visibility: 'FAMILY',
    familyId: '',
  })

  // Get selected family details with members
  const { family } = useFamily(formData.familyId || undefined)

  // Fetch saved places for location dropdown
  interface SavedPlace {
    id: string
    name: string
    address: string | null
    icon: string | null
  }
  
  const placesFetcher = async (url: string) => {
    const res = await authFetch(url)
    if (!res.ok) return []
    const data = await res.json()
    return data.data || []
  }
  
  const { data: savedPlaces = [] } = useSWR<SavedPlace[]>(
    formData.familyId ? `/api/places?familyId=${formData.familyId}` : null,
    placesFetcher
  )

  // Pre-fill reminders from the person's default reminder times (Settings >
  // Notifications). Only applied once, and only if they haven't already
  // touched the reminder checkboxes while this loaded.
  const remindersTouched = useRef(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch('/api/user/notification-settings')
        if (!res.ok) return
        const data = await res.json()
        const defaults = data?.data?.defaultReminderMinutes
        if (!cancelled && Array.isArray(defaults) && defaults.length > 0) {
          setSelectedReminders(prev => (remindersTouched.current ? prev : defaults))
        }
      } catch {
        // keep the built-in default
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Set default family when loaded
  useEffect(() => {
    if (families.length > 0 && !formData.familyId) {
      setFormData(prev => ({ ...prev, familyId: families[0].id }))
    }
  }, [families, formData.familyId])

  // Clear participants when family changes
  useEffect(() => {
    setSelectedParticipants([])
  }, [formData.familyId])

  const toggleParticipant = (
    type: 'member' | 'child',
    id: string,
    userId: string | undefined,
    childProfileId: string | undefined,
    displayName: string,
    avatarUrl: string | null
  ) => {
    setSelectedParticipants(prev => {
      const exists = prev.some(p => p.id === id && p.type === type)
      if (exists) {
        return prev.filter(p => !(p.id === id && p.type === type))
      }
      return [...prev, { type, id, userId, childProfileId, displayName, avatarUrl }]
    })
  }

  const isParticipantSelected = (type: 'member' | 'child', id: string) => {
    return selectedParticipants.some(p => p.id === id && p.type === type)
  }

  const removeParticipant = (type: 'member' | 'child', id: string) => {
    setSelectedParticipants(prev => prev.filter(p => !(p.id === id && p.type === type)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      toast.error('Please enter an event title')
      return
    }
    
    if (!formData.familyId) {
      toast.error('Please select a family')
      return
    }
    
    setIsSubmitting(true)
    
    try {
      // Build a correct, timezone-aware UTC instant from the local date/time
      // inputs (see lib/datetime.ts) instead of concatenating strings with
      // no offset, which used to get silently mis-saved by the TIMESTAMPTZ
      // column as if the local time were already UTC.
      const startTime = allDay
        ? localStartOfDayToISO(formData.startDate)
        : localDateTimeToISO(formData.startDate, formData.startTime)

      const endTime = allDay
        ? localEndOfDayToISO(formData.endDate)
        : localDateTimeToISO(formData.endDate, formData.endTime)
      
      const res = await authFetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          familyId: formData.familyId,
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          startTime,
          endTime,
          allDay,
          location: formData.location.trim() || null,
          category: formData.category,
          visibility: formData.visibility,
          reminderMinutes: selectedReminders,
          notifyChannels: notifyChannels.length > 0 ? notifyChannels : undefined,
          isRecurring,
          recurrenceRule: isRecurring ? recurrenceRule : null,
          participants: selectedParticipants.map(p => ({
            userId: p.userId,
            childProfileId: p.childProfileId,
          })),
        }),
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        toast.error(data.error || 'Failed to create event')
        return
      }
      
      // Invalidate the events cache so the calendar page shows the new event
      await mutate((key) => typeof key === 'string' && key.startsWith('/api/events'), undefined, { revalidate: true })
      
      toast.success('Event created successfully!')
      router.push('/calendar')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create event')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (authLoading || familiesLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    router.push('/login')
    return null
  }

  return (
    <div className="container max-w-2xl py-6">
      <Button
        variant="ghost"
        className="mb-4"
        onClick={() => router.back()}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Create New Event</CardTitle>
          <CardDescription>
            Add a new event to your family calendar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Family Selection */}
            {families.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="family">Family</Label>
                <Select
                  value={formData.familyId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, familyId: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select family" />
                  </SelectTrigger>
                  <SelectContent>
                    {families.map((family) => (
                      <SelectItem key={family.id} value={family.id}>
                        {family.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Event Title *</Label>
              <Input
                id="title"
                placeholder="Enter event title"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                required
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Add event details..."
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
              />
            </div>

            {/* All Day Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allDay">All Day Event</Label>
                <p className="text-sm text-muted-foreground">
                  Event spans the entire day
                </p>
              </div>
              <Switch
                id="allDay"
                checked={allDay}
                onCheckedChange={setAllDay}
              />
            </div>

            {/* Date & Time */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  <CalendarIcon className="h-4 w-4 inline mr-1" />
                  Start Date *
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData(prev => ({ 
                    ...prev, 
                    startDate: e.target.value,
                    endDate: e.target.value > prev.endDate ? e.target.value : prev.endDate
                  }))}
                  required
                />
              </div>
              
              {!allDay && (
                <div className="space-y-2">
                  <Label htmlFor="startTime">
                    <Clock className="h-4 w-4 inline mr-1" />
                    Start Time *
                  </Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, startTime: e.target.value }))}
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="endDate">End Date *</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  min={formData.startDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, endDate: e.target.value }))}
                  required
                />
              </div>
              
              {!allDay && (
                <div className="space-y-2">
                  <Label htmlFor="endTime">End Time *</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, endTime: e.target.value }))}
                    required
                  />
                </div>
              )}
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">
                <MapPin className="h-4 w-4 inline mr-1" />
                Location
              </Label>
              {savedPlaces.length > 0 && (
                <Select
                  value=""
                  onValueChange={(placeId) => {
                    const place = savedPlaces.find(p => p.id === placeId)
                    if (place) {
                      setFormData(prev => ({ 
                        ...prev, 
                        location: place.address || place.name 
                      }))
                    }
                  }}
                >
                  <SelectTrigger className="mb-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Star className="h-4 w-4" />
                      <span>Select from saved places...</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {savedPlaces.map((place) => (
                      <SelectItem key={place.id} value={place.id}>
                        <div className="flex items-center gap-2">
                          <span>{place.name}</span>
                          {place.address && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              - {place.address}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Input
                id="location"
                placeholder="Add location or type a custom address"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category">
                <Tag className="h-4 w-4 inline mr-1" />
                Category
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${cat.color}`} />
                        {cat.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <Label htmlFor="visibility">
                <Eye className="h-4 w-4 inline mr-1" />
                Visibility
              </Label>
              <Select
                value={formData.visibility}
                onValueChange={(value) => setFormData(prev => ({ ...prev, visibility: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VISIBILITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
  </div>

            {/* Recurring Event */}
            <div className="space-y-4 p-4 rounded-lg border border-border">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="is-recurring" className="font-medium">Recurring Event</Label>
                  <p className="text-sm text-muted-foreground">
                    Repeat this event on a schedule
                  </p>
                </div>
                <Switch
                  id="is-recurring"
                  checked={isRecurring}
                  onCheckedChange={setIsRecurring}
                />
              </div>
              {isRecurring && (
                <div className="space-y-2 pt-2 border-t">
                  <Label>Repeat</Label>
                  <Select value={recurrenceRule} onValueChange={setRecurrenceRule}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="weekdays">Weekdays (Mon-Fri)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Reminders */}
            <div className="space-y-2">
              <Label>
                <Bell className="h-4 w-4 inline mr-1" />
                Reminders
              </Label>
              <div className="space-y-2">
                {REMINDER_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`reminder-${opt.value}`}
                      checked={selectedReminders.includes(opt.value)}
                      onCheckedChange={(checked) => {
                        remindersTouched.current = true
                        if (checked) {
                          setSelectedReminders(prev => [...prev, opt.value].sort((a, b) => a - b))
                        } else {
                          setSelectedReminders(prev => prev.filter(v => v !== opt.value))
                        }
                      }}
                    />
                    <label 
                      htmlFor={`reminder-${opt.value}`}
                      className="text-sm cursor-pointer"
                    >
                      {opt.label}
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                You'll receive notifications before the event starts
              </p>
            </div>

            {/* Notification Channels */}
            <NotificationChannelsPicker
              selected={notifyChannels}
              onChange={setNotifyChannels}
              label="Notify participants via"
              helpText="Leave unchecked to use each participant's own notification settings."
            />

  {/* Participants */}
  <div className="space-y-2">
  <Label>
  <Users className="h-4 w-4 inline mr-1" />
                Participants
              </Label>
              
              {/* Selected participants badges */}
              {selectedParticipants.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedParticipants.map((p) => (
                    <Badge key={`${p.type}-${p.id}`} variant="secondary" className="pl-1 pr-1 gap-1">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={p.avatarUrl || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {p.displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="max-w-[100px] truncate">{p.displayName}</span>
                      <button
                        type="button"
                        onClick={() => removeParticipant(p.type, p.id)}
                        className="ml-1 hover:bg-muted rounded-full p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-full justify-start">
                    <Users className="h-4 w-4 mr-2" />
                    {selectedParticipants.length === 0 
                      ? 'Add participants...'
                      : `${selectedParticipants.length} participant${selectedParticipants.length > 1 ? 's' : ''} selected`
                    }
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <div className="p-3 border-b">
                    <h4 className="font-medium text-sm">Select Participants</h4>
                    <p className="text-xs text-muted-foreground">Choose family members to invite</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {!family ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        Select a family first
                      </div>
                    ) : (
                      <>
                        {/* Adult Members */}
                        {family.members && family.members.length > 0 && (
                          <div className="p-2">
                            <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                              Family Members
                            </div>
                            {family.members.map((member) => (
                              <button
                                key={member.id}
                                type="button"
                                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-muted rounded-md transition-colors"
                                onClick={() => toggleParticipant(
                                  'member',
                                  member.id,
                                  member.userId,
                                  undefined,
                                  member.displayName,
                                  member.avatarUrl
                                )}
                              >
                                <div className={`flex items-center justify-center h-5 w-5 rounded border ${
                                  isParticipantSelected('member', member.id)
                                    ? 'bg-primary border-primary'
                                    : 'border-input'
                                }`}>
                                  {isParticipantSelected('member', member.id) && (
                                    <Check className="h-3 w-3 text-primary-foreground" />
                                  )}
                                </div>
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={member.avatarUrl || undefined} />
                                  <AvatarFallback>
                                    {member.displayName.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 text-left">
                                  <div className="font-medium text-sm">{member.displayName}</div>
                                  <div className="text-xs text-muted-foreground capitalize">
                                    {member.role.toLowerCase()}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Children */}
                        {family.children && family.children.length > 0 && (
                          <div className="p-2 border-t">
                            <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                              Children
                            </div>
                            {family.children.map((child) => (
                              <button
                                key={child.id}
                                type="button"
                                className="w-full flex items-center gap-3 px-2 py-2 hover:bg-muted rounded-md transition-colors"
                                onClick={() => toggleParticipant(
                                  'child',
                                  child.id,
                                  undefined,
                                  child.id,
                                  child.displayName,
                                  child.avatarUrl
                                )}
                              >
                                <div className={`flex items-center justify-center h-5 w-5 rounded border ${
                                  isParticipantSelected('child', child.id)
                                    ? 'bg-primary border-primary'
                                    : 'border-input'
                                }`}>
                                  {isParticipantSelected('child', child.id) && (
                                    <Check className="h-3 w-3 text-primary-foreground" />
                                  )}
                                </div>
                                <Avatar className="h-8 w-8">
                                  <AvatarImage src={child.avatarUrl || undefined} />
                                  <AvatarFallback>
                                    {child.displayName.charAt(0).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 text-left">
                                  <div className="font-medium text-sm">{child.displayName}</div>
                                  {child.grade && (
                                    <div className="text-xs text-muted-foreground">
                                      Grade {child.grade}
                                    </div>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {(!family.members || family.members.length === 0) && 
                         (!family.children || family.children.length === 0) && (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            No family members found
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Optional. Select family members who should be notified about this event.
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 pb-safe">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-12 touch-target"
                onClick={() => router.back()}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 h-12 touch-target"
                disabled={isSubmitting || !formData.familyId}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Event'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
