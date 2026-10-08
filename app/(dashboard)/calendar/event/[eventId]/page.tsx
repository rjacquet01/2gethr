'use client'

import { customCategoryColor, formatCategory } from '@/lib/categories'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEvent } from '@/hooks/use-events'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  MapPin, 
  Users,
  Edit,
  Trash2,
  Repeat,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  { value: 'GENERAL', label: 'General', color: 'bg-slate-500' },
  { value: 'SCHOOL', label: 'School', color: 'bg-blue-500' },
  { value: 'SPORTS', label: 'Sports', color: 'bg-green-500' },
  { value: 'MEDICAL', label: 'Medical', color: 'bg-red-500' },
  { value: 'SOCIAL', label: 'Social', color: 'bg-purple-500' },
  { value: 'WORK', label: 'Work', color: 'bg-orange-500' },
  { value: 'TRAVEL', label: 'Travel', color: 'bg-cyan-500' },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-500' },
]

export default function EventDetailPage() {
  const params = useParams()
  const router = useRouter()
  const eventId = params.eventId as string
  
  const { event, isLoading, deleteEvent } = useEvent(eventId)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const handleDelete = async (deleteRecurrence: boolean = false) => {
    setIsDeleting(true)
    const result = await deleteEvent(deleteRecurrence)
    setIsDeleting(false)
    
    if (result.success) {
      toast.success('Event deleted')
      router.push('/calendar')
    } else {
      toast.error(result.error || 'Failed to delete event')
    }
  }
  
  const getCategoryInfo = (category: string) => {
    return CATEGORIES.find(c => c.value === category) || { value: category, label: formatCategory(category), color: customCategoryColor(category) }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
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
            <Button variant="link" asChild className="mt-2">
              <Link href="/calendar">Return to calendar</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const categoryInfo = getCategoryInfo(event.category)
  const startDate = parseISO(event.startTime)
  const endDate = parseISO(event.endTime)

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link href="/calendar">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Calendar
          </Link>
        </Button>
        
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href={`/calendar/event/${eventId}/edit`}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Link>
          </Button>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isDeleting}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Event</AlertDialogTitle>
                <AlertDialogDescription>
                  {event.recurrenceId ? (
                    "This is a recurring event. Do you want to delete just this occurrence or all occurrences?"
                  ) : (
                    "Are you sure you want to delete this event? This action cannot be undone."
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                {event.recurrenceId ? (
                  <>
                    <AlertDialogAction onClick={() => handleDelete(false)}>
                      This Event Only
                    </AlertDialogAction>
                    <AlertDialogAction 
                      onClick={() => handleDelete(true)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      All Occurrences
                    </AlertDialogAction>
                  </>
                ) : (
                  <AlertDialogAction onClick={() => handleDelete(false)}>
                    Delete
                  </AlertDialogAction>
                )}
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Event Details */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className={cn('w-2 rounded-full self-stretch min-h-16', categoryInfo.color)} />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="secondary">{categoryInfo.label}</Badge>
                {event.allDay && <Badge variant="outline">All Day</Badge>}
                {event.recurrenceId && (
                  <Badge variant="outline">
                    <Repeat className="w-3 h-3 mr-1" />
                    Recurring
                  </Badge>
                )}
                {event.status === 'PENDING' && (
                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                    Pending Approval
                  </Badge>
                )}
              </div>
              <CardTitle className="text-2xl">{event.title}</CardTitle>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Date & Time */}
          <div className="flex items-start gap-3">
            <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="font-medium">{format(startDate, 'EEEE, MMMM d, yyyy')}</p>
              {!event.allDay && (
                <p className="text-sm text-muted-foreground">
                  {format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}
                </p>
              )}
            </div>
          </div>
          
          {/* Duration */}
          {!event.allDay && (
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">Duration</p>
                <p className="text-sm text-muted-foreground">
                  {(() => {
                    const totalMinutes = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60))
                    const hours = Math.floor(totalMinutes / 60)
                    const minutes = totalMinutes % 60
                    if (hours === 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`
                    if (minutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`
                    return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`
                  })()}
                </p>
              </div>
            </div>
          )}
          
          {/* Location */}
          {event.location && (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">Location</p>
                <p className="text-sm text-muted-foreground">{event.location}</p>
              </div>
            </div>
          )}
          
          {/* Participants */}
          {event.participants && event.participants.length > 0 && (
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">Participants</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {event.participants.map((p, i) => (
                    <Badge key={i} variant="outline">
                      {p.displayName || 'Unknown'}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {/* Description */}
          {event.description && (
            <div className="pt-4 border-t">
              <h3 className="font-medium mb-2">Description</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}
          
          {/* Metadata */}
          <div className="pt-4 border-t text-sm text-muted-foreground">
            <p>Created: {format(parseISO(event.createdAt), 'MMM d, yyyy h:mm a')}</p>
            <p>Visibility: {event.visibility?.replace('_', ' ') || 'Family'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
