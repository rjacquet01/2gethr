'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEvent } from '@/hooks/use-events'
import { authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CategoryPicker } from '@/components/category-picker'
import { NotificationChannelsPicker, type NotificationChannelValue } from '@/components/notification-channels-picker'
import { ColorPicker } from '@/components/customization'
import { cleanCustomCategory } from '@/lib/categories'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { useFamily } from '@/hooks/use-family'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Calendar, Clock, MapPin, Save } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { localDateTimeToISO, localStartOfDayToISO, localEndOfDayToISO } from '@/lib/datetime'

const CATEGORIES = [
  { value: 'GENERAL', label: 'General' },
  { value: 'SCHOOL', label: 'School' },
  { value: 'SPORTS', label: 'Sports' },
  { value: 'MEDICAL', label: 'Medical' },
  { value: 'SOCIAL', label: 'Social' },
  { value: 'WORK', label: 'Work' },
  { value: 'TRAVEL', label: 'Travel' },
  { value: 'OTHER', label: 'Other' },
]

export default function EditEventPage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.eventId as string
  
  const { event, isLoading, mutate } = useEvent(eventId)
  const [isSaving, setIsSaving] = useState(false)
  const [notifyChannels, setNotifyChannels] = useState<NotificationChannelValue[]>([])
  const [participantUserIds, setParticipantUserIds] = useState<string[]>([])
  const eventFamilyId = (event as unknown as { calendar?: { familyId?: string } } | undefined)?.calendar?.familyId
  const { family } = useFamily(eventFamilyId)
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    allDay: false,
    category: 'OTHER',
    color: '',
    visibility: 'FAMILY',
    isRecurring: false,
    recurrenceRule: 'weekly',
  })

  // Populate form when event loads
  useEffect(() => {
    if (event) {
      const startDate = parseISO(event.startTime)
      const endDate = parseISO(event.endTime)
      
      setFormData({
        title: event.title || '',
        description: event.description || '',
        location: event.location || '',
        startDate: format(startDate, 'yyyy-MM-dd'),
        startTime: event.allDay ? '' : format(startDate, 'HH:mm'),
        endDate: format(endDate, 'yyyy-MM-dd'),
        endTime: event.allDay ? '' : format(endDate, 'HH:mm'),
        allDay: event.allDay || false,
        category: event.category || 'OTHER',
        color: (event as unknown as { customColor?: string | null }).customColor || '',
        visibility: event.visibility || 'FAMILY',
        isRecurring: event.isRecurring || false,
        recurrenceRule: event.recurrence?.frequency?.toLowerCase() || 'weekly',
      })
    }
    if (event) {
      setNotifyChannels(((event as unknown as { notifyChannels?: NotificationChannelValue[] }).notifyChannels) || [])
      const existing = (event as unknown as { participants?: Array<{ userId?: string | null }> }).participants || []
      setParticipantUserIds(existing.map((p) => p.userId).filter((id): id is string => !!id))
    }
  }, [event])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title.trim()) {
      toast.error('Please enter an event title')
      return
    }

    setIsSaving(true)
    
    try {
      // Build a correct, timezone-aware UTC instant from the local date/time
      // inputs (see lib/datetime.ts). This used to force a trailing "Z"
      // onto the locally-typed value, mislabeling it as already being UTC
      // and shifting saved times by the browser's UTC offset.
      let startTime: string
      let endTime: string

      if (formData.allDay) {
        startTime = localStartOfDayToISO(formData.startDate)
        endTime = localEndOfDayToISO(formData.endDate)
      } else {
        startTime = localDateTimeToISO(formData.startDate, formData.startTime)
        endTime = localDateTimeToISO(formData.endDate, formData.endTime)
      }
      
      const res = await authFetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          location: formData.location.trim() || null,
          startTime,
          endTime,
          isAllDay: formData.allDay,
          visibility: formData.visibility,
          category: cleanCustomCategory(formData.category) || 'OTHER',
          color: formData.color || null,
          notifyChannels,
          participantUserIds,
        }),
      })
      
      const data = await res.json()
      
      if (data.success) {
        toast.success('Event updated successfully')
        mutate()
        router.push(`/calendar/event/${eventId}`)
      } else {
        toast.error(data.error || 'Failed to update event')
      }
    } catch {
      toast.error('Failed to update event')
    }
    
    setIsSaving(false)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild>
          <Link href="/calendar">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Calendar
          </Link>
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground">Event not found</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link href={`/calendar/event/${eventId}`}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Event
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Edit Event
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Event Title *</Label>
              <Input
                id="title"
                placeholder="Enter event title"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Add event description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
              />
            </div>

            {/* Location */}
            <div className="space-y-2">
              <Label htmlFor="location">
                <MapPin className="w-4 h-4 inline mr-1" />
                Location
              </Label>
              <Input
                id="location"
                placeholder="Enter location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </div>

            {/* All Day Toggle */}
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div>
                <Label htmlFor="allDay">All Day Event</Label>
                <p className="text-sm text-muted-foreground">
                  Event spans the entire day
                </p>
              </div>
              <Switch
                id="allDay"
                checked={formData.allDay}
                onCheckedChange={(checked) => setFormData({ ...formData, allDay: checked })}
              />
            </div>

            {/* Date and Time */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Start Date
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              {!formData.allDay && (
                <div className="space-y-2">
                  <Label htmlFor="startTime">Start Time</Label>
                  <Input
                    id="startTime"
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
              {!formData.allDay && (
                <div className="space-y-2">
                  <Label htmlFor="endTime">End Time</Label>
                  <Input
                    id="endTime"
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                  />
                </div>
              )}
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label>Category</Label>
              <CategoryPicker
                value={formData.category}
                onChange={(value) => setFormData({ ...formData, category: value })}
                options={CATEGORIES}
              />
            </div>

            {/* Event color */}
            <div className="space-y-2">
              <Label>Event color</Label>
              <p className="text-xs text-muted-foreground">
                Optional. Pick a color to make this event stand out on the calendar.
              </p>
              <ColorPicker
                value={formData.color}
                onChange={(color) => setFormData({ ...formData, color })}
                onClear={() => setFormData({ ...formData, color: '' })}
                clearLabel="Category color"
              />
            </div>

            {/* Notification Channels */}
            <NotificationChannelsPicker
              selected={notifyChannels}
              onChange={setNotifyChannels}
              label="Notify participants via"
              helpText="Leave unchecked to use each participant's own notification settings."
            />

            {/* Visibility */}
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={formData.visibility}
                onValueChange={(value) => setFormData({ ...formData, visibility: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select visibility" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FAMILY">Entire Family</SelectItem>
                  <SelectItem value="PRIVATE">Private</SelectItem>
                  <SelectItem value="SELECTED_MEMBERS">Selected Members</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Participants */}
            <div className="space-y-2">
              <Label>Participants</Label>
              <p className="text-xs text-muted-foreground">Choose the family members invited to this event.</p>
              {!family ? (
                <p className="text-sm text-muted-foreground">Loading family members...</p>
              ) : (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  {(family.members || []).filter((m) => m.isActive !== false && m.userId).map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`participant-${m.id}`}
                        checked={participantUserIds.includes(m.userId)}
                        onCheckedChange={(checked) =>
                          setParticipantUserIds((prev) =>
                            checked ? Array.from(new Set([...prev, m.userId])) : prev.filter((id) => id !== m.userId)
                          )
                        }
                      />
                      <label htmlFor={`participant-${m.id}`} className="text-sm cursor-pointer">
                        {m.displayName} <span className="text-xs text-muted-foreground capitalize">({m.role.toLowerCase()})</span>
                      </label>
                    </div>
                  ))}
                  {(family.members || []).length === 0 && (
                    <p className="text-sm text-muted-foreground">No eligible members found.</p>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" asChild className="flex-1">
                <Link href={`/calendar/event/${eventId}`}>Cancel</Link>
              </Button>
              <Button type="submit" disabled={isSaving} className="flex-1">
                {isSaving ? <Spinner className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save Changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
