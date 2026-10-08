'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useFamilies } from '@/hooks/use-family'
import { useEvents } from '@/hooks/use-events'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Clock,
  MapPin,
  Filter,
  Calendar,
  X
} from 'lucide-react'
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'

type ViewMode = 'month' | 'week' | 'day'

const CATEGORIES = [
  { value: 'ALL', label: 'All Categories' },
  { value: 'SCHOOL', label: 'School', color: 'bg-blue-500' },
  { value: 'SPORTS', label: 'Sports', color: 'bg-green-500' },
  { value: 'MEDICAL', label: 'Medical', color: 'bg-red-500' },
  { value: 'SOCIAL', label: 'Social', color: 'bg-purple-500' },
  { value: 'WORK', label: 'Work', color: 'bg-orange-500' },
  { value: 'TRAVEL', label: 'Travel', color: 'bg-cyan-500' },
  { value: 'GENERAL', label: 'General', color: 'bg-slate-500' },
  { value: 'OTHER', label: 'Other', color: 'bg-gray-500' },
]

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('month')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showEventSheet, setShowEventSheet] = useState(false)
  
  const { families, isLoading: familiesLoading } = useFamilies()
  const primaryFamily = families[0]
  
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  
  const { events, isLoading: eventsLoading } = useEvents({
    familyId: primaryFamily?.id,
    startDate: viewMode === 'month' 
      ? startOfWeek(monthStart).toISOString()
      : weekStart.toISOString(),
    endDate: viewMode === 'month'
      ? endOfWeek(monthEnd).toISOString()
      : weekEnd.toISOString(),
    category: selectedCategory !== 'ALL' ? selectedCategory : undefined,
  })

  const calendarDays = useMemo(() => {
    if (viewMode === 'month') {
      return eachDayOfInterval({
        start: startOfWeek(monthStart, { weekStartsOn: 0 }),
        end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
      })
    }
    return eachDayOfInterval({ start: weekStart, end: weekEnd })
  }, [currentDate, viewMode, monthStart, monthEnd, weekStart, weekEnd])

  const getEventsForDay = (day: Date) => {
    return events.filter(event => {
      const eventDate = parseISO(event.startTime)
      return isSameDay(eventDate, day) && (event.status === 'APPROVED' || event.status === 'ACTIVE')
    })
  }

  const getCategoryColor = (category: string) => {
    const cat = CATEGORIES.find(c => c.value === category)
    return cat?.color || 'bg-gray-500'
  }

  const navigatePrevious = () => {
    if (viewMode === 'month') {
      setCurrentDate(subMonths(currentDate, 1))
    } else {
      setCurrentDate(subWeeks(currentDate, 1))
    }
  }

  const navigateNext = () => {
    if (viewMode === 'month') {
      setCurrentDate(addMonths(currentDate, 1))
    } else {
      setCurrentDate(addWeeks(currentDate, 1))
    }
  }

  const navigateToday = () => {
    setCurrentDate(new Date())
  }

  const handleDayClick = (day: Date) => {
    setSelectedDate(day)
    // On mobile, show the event sheet
    if (window.innerWidth < 1024) {
      setShowEventSheet(true)
    }
  }

  const selectedDayEvents = selectedDate ? getEventsForDay(selectedDate) : []

  if (familiesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4">
        {/* Navigation Row. min-w-0/truncate on the title and shrink-0 on both
            button groups keep a long month name (e.g. "September 2026") from
            overflowing and overlapping the nav/new buttons on narrow phones
            in portrait mode, matching the fix used for task card overlap. */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="icon" onClick={navigatePrevious} className="h-10 w-10 sm:h-10 sm:w-10">
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <Button variant="outline" size="icon" onClick={navigateNext} className="h-10 w-10 sm:h-10 sm:w-10">
              <ChevronRight className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={navigateToday} className="h-10 px-2 sm:px-3 text-sm font-medium shrink-0">
              Today
            </Button>
          </div>

          <h1 className="text-base sm:text-xl font-bold text-foreground text-center flex-1 min-w-0 truncate px-1 sm:px-2">
            {format(currentDate, viewMode === 'month' ? 'MMMM yyyy' : "'Week of' MMM d")}
          </h1>

          <Button asChild size="sm" className="h-10 w-10 sm:w-auto sm:px-4 shrink-0">
            <Link href={selectedDate ? `/calendar/new?date=${format(selectedDate, 'yyyy-MM-dd')}` : '/calendar/new'}>
              <Plus className="w-5 h-5 sm:mr-2" />
              <span className="hidden sm:inline">New</span>
            </Link>
          </Button>
        </div>
        
        {/* Filters Row */}
        <div className="flex items-center gap-3">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="flex-1 sm:w-44 sm:flex-none h-10 text-sm">
              <Filter className="w-4 h-4 mr-2 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(cat => (
                <SelectItem key={cat.value} value={cat.value}>
                  <div className="flex items-center gap-2">
                    {cat.color && <div className={`w-3 h-3 rounded-full ${cat.color}`} />}
                    {cat.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="flex-1 sm:flex-none">
            <TabsList className="grid w-full grid-cols-2 h-10">
              <TabsTrigger value="month" className="text-sm">Month</TabsTrigger>
              <TabsTrigger value="week" className="text-sm">Week</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Calendar Grid */}
        <Card className="overflow-hidden">
          <CardContent className="p-2 sm:p-4">
            {/* Day Headers */}
            <div className="grid grid-cols-7 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                <div key={i} className="text-center text-xs sm:text-sm font-semibold text-muted-foreground py-2 sm:py-3">
                  <span className="sm:hidden">{day.slice(0, 3)}</span>
                  <span className="hidden sm:inline">{day}</span>
                </div>
              ))}
            </div>
            
            {/* Calendar Days */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
              {eventsLoading ? (
                Array.from({ length: 35 }).map((_, i) => (
                  <Skeleton key={i} className="min-h-16 sm:min-h-24" />
                ))
              ) : (
                calendarDays.map((day) => {
                  const dayEvents = getEventsForDay(day)
                  const isCurrentMonth = isSameMonth(day, currentDate)
                  const isSelected = selectedDate && isSameDay(day, selectedDate)
                  
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => handleDayClick(day)}
                      className={cn(
                        'min-h-16 sm:min-h-24 p-1.5 sm:p-2 flex flex-col bg-background transition-colors active:bg-muted/70',
                        !isCurrentMonth && 'bg-muted/20 text-muted-foreground/60',
                        isSelected && 'ring-2 ring-primary ring-inset bg-primary/10',
                        isToday(day) && !isSelected && 'bg-primary/5'
                      )}
                    >
                      <div className={cn(
                        'text-sm sm:text-sm font-semibold mb-1 self-center sm:self-start',
                        isToday(day) && 'flex items-center justify-center w-7 h-7 sm:w-7 sm:h-7 rounded-full bg-primary text-primary-foreground'
                      )}>
                        {format(day, 'd')}
                      </div>
                      {/* Mobile: show colored dots for events */}
                      <div className="flex flex-wrap gap-1 sm:hidden justify-center items-center flex-1">
                        {dayEvents.length > 0 && (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-1">
                              {dayEvents.slice(0, 3).map((event) => (
                                <div
                                  key={event.id}
                                  className={cn(
                                    'w-2 h-2 rounded-full',
                                    getCategoryColor(event.category)
                                  )}
                                />
                              ))}
                            </div>
                            {dayEvents.length > 0 && (
                              <span className="text-[10px] font-medium text-muted-foreground">
                                {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Desktop: show event titles */}
                      <div className="hidden sm:block space-y-1 flex-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            className={cn(
                              'text-xs px-1.5 py-0.5 rounded truncate text-white',
                              getCategoryColor(event.category)
                            )}
                          >
                            {event.title}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-xs text-muted-foreground px-1">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Desktop: Selected Day Events Sidebar */}
        <Card className="hidden lg:block">
          <CardContent className="p-4">
            <h2 className="font-semibold text-foreground mb-4">
              {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : 'Select a day'}
            </h2>
            
            {selectedDate ? (
              selectedDayEvents.length === 0 ? (
                <div className="text-center py-8">
                  <Calendar className="w-10 h-10 mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No events</p>
                  <Button variant="link" asChild className="mt-2">
                    <Link href={`/calendar/new?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                      Add an event
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDayEvents.map((event) => (
                    <Link
                      key={event.id}
                      href={`/calendar/event/${event.id}`}
                      className="block p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn('w-1 h-full min-h-12 rounded-full', getCategoryColor(event.category))} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground">{event.title}</p>
                          {!event.allDay && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Clock className="w-3 h-3" />
                              {format(parseISO(event.startTime), 'h:mm a')} - {format(parseISO(event.endTime), 'h:mm a')}
                            </p>
                          )}
                          {event.location && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <MapPin className="w-3 h-3" />
                              {event.location}
                            </p>
                          )}
                          <div className="mt-2">
                            <Badge variant="secondary" className="text-xs">
                              {CATEGORIES.find(c => c.value === event.category)?.label || event.category}
                            </Badge>
                            {event.allDay && (
                              <Badge variant="outline" className="text-xs ml-1">All day</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Click on a day to see events
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Mobile: Bottom Sheet for Selected Day Events */}
      <Sheet open={showEventSheet} onOpenChange={setShowEventSheet}>
        <SheetContent side="bottom" className="h-[70vh] rounded-t-2xl">
          <SheetHeader className="pb-4">
            <div className="flex items-center justify-between">
              <SheetTitle>
                {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : 'Events'}
              </SheetTitle>
              <Button variant="ghost" size="icon" onClick={() => setShowEventSheet(false)} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </SheetHeader>
          
          <div className="overflow-y-auto h-full pb-20">
            {selectedDate && selectedDayEvents.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground mb-4">No events on this day</p>
                <Button asChild>
                  <Link href={`/calendar/new?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Event
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/calendar/event/${event.id}`}
                    className="block p-4 rounded-xl border border-border active:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn('w-1.5 self-stretch rounded-full', getCategoryColor(event.category))} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground text-base">{event.title}</p>
                        {!event.allDay && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1.5">
                            <Clock className="w-4 h-4" />
                            {format(parseISO(event.startTime), 'h:mm a')} - {format(parseISO(event.endTime), 'h:mm a')}
                          </p>
                        )}
                        {event.location && (
                          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
                            <MapPin className="w-4 h-4" />
                            <span className="truncate">{event.location}</span>
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="secondary">
                            {CATEGORIES.find(c => c.value === event.category)?.label || event.category}
                          </Badge>
                          {event.allDay && (
                            <Badge variant="outline">All day</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                
                {selectedDate && (
                  <Button asChild variant="outline" className="w-full mt-4 h-12">
                    <Link href={`/calendar/new?date=${format(selectedDate, 'yyyy-MM-dd')}`}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Event
                    </Link>
                  </Button>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
