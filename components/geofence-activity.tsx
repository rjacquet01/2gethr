'use client'

import useSWR from 'swr'
import { formatDistanceToNow, format } from 'date-fns'
import { LogIn, LogOut, MapPin, Crown, BellRing } from 'lucide-react'
import { authFetch } from '@/hooks/use-auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface ActivityEvent {
  id: string
  type: 'ARRIVAL' | 'DEPARTURE'
  at: string
  memberName: string
  isMe: boolean
  placeId: string
  placeName: string
  placeColor: string | null
}

interface ActivityResponse {
  scope: 'family' | 'self'
  events: ActivityEvent[]
}

const fetcher = async (url: string): Promise<ActivityResponse> => {
  const res = await authFetch(url, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch')
  const json = await res.json()
  return json.data
}

/**
 * Saved Places summary + the last 24 hours of geofence arrivals/departures.
 * Parents/guardians see every member; everyone else sees only their own.
 */
export function GeofenceActivityCard({
  familyId,
  placeCount,
  maxPlaces,
  geofenceCount,
  canAddMore,
}: {
  familyId: string
  placeCount: number
  maxPlaces: number
  geofenceCount: number
  canAddMore: boolean
}) {
  const { data, isLoading } = useSWR<ActivityResponse>(
    `/api/places/activity?familyId=${familyId}`,
    fetcher,
    { refreshInterval: 60_000 }
  )
  const events = data?.events ?? []
  const everyone = data?.scope !== 'self'

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Saved Places</CardTitle>
            <CardDescription>
              {placeCount} of {maxPlaces === Infinity ? 'unlimited' : maxPlaces} places
              {' · '}
              {geofenceCount} with geofence alerts
            </CardDescription>
          </div>
          {!canAddMore && (
            <Badge variant="secondary" className="shrink-0">
              <Crown className="w-3 h-3 mr-1" />
              Upgrade for more
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          <BellRing className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium">
            {everyone ? 'Family activity' : 'Your activity'}
            <span className="text-muted-foreground font-normal"> · last 24 hours</span>
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {geofenceCount === 0
              ? 'Turn on geofence alerts for a place to see arrivals and departures here.'
              : 'No arrivals or departures in the last 24 hours.'}
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y rounded-lg border">
            {events.map((e) => {
              const arrival = e.type === 'ARRIVAL'
              const when = new Date(e.at)
              return (
                <li key={e.id} className="flex items-center gap-3 p-3">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${
                      arrival
                        ? 'bg-green-500/10 text-green-600'
                        : 'bg-amber-500/10 text-amber-600'
                    }`}
                  >
                    {arrival ? <LogIn className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">
                      <span className="font-medium">{e.isMe ? 'You' : e.memberName}</span>{' '}
                      {arrival ? 'arrived at' : 'left'}{' '}
                      <span className="inline-flex items-center gap-1 font-medium">
                        <MapPin className="w-3 h-3" style={{ color: e.placeColor || undefined }} />
                        {e.placeName}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(when, 'h:mm a')} · {formatDistanceToNow(when, { addSuffix: true })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
