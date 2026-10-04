'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Trash2, ListTodo, Calendar, Copy, Check, Upload, Link2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { useCalendarSync } from '@/hooks/use-calendar-sync'
import { authFetch } from '@/hooks/use-auth'
import { format } from 'date-fns'
import { toast } from 'sonner'

// Google Calendar icon
function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V6C20 4.89543 19.1046 4 18 4Z" fill="#FFFFFF" stroke="#4285F4" strokeWidth="2"/>
      <path d="M16 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round"/>
      <path d="M8 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round"/>
      <path d="M4 10H20" stroke="#4285F4" strokeWidth="2"/>
      <rect x="7" y="13" width="3" height="3" fill="#EA4335"/>
      <rect x="11" y="13" width="3" height="3" fill="#FBBC05"/>
      <rect x="15" y="13" width="3" height="3" fill="#34A853"/>
    </svg>
  )
}



// Next.js requires any component that calls useSearchParams() to be wrapped
// in a Suspense boundary, or the page fails to prerender at build time
// ("useSearchParams() should be wrapped in a suspense boundary").
export default function CalendarSyncPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Spinner className="w-8 h-8" />
        </div>
      }
    >
      <CalendarSyncContent />
    </Suspense>
  )
}

function CalendarSyncContent() {
  const searchParams = useSearchParams()
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const {
    googleConnection,
    appleConnection,
    isLoading,
    isSyncing,
    connectGoogle,
    disconnect,
    updateConnection,
    syncNow,
  } = useCalendarSync()

  const [taskSyncEnabled, setTaskSyncEnabled] = useState(false)
  const [isTogglingTaskSync, setIsTogglingTaskSync] = useState(false)
  const [isSyncingAll, setIsSyncingAll] = useState(false)

  // Runs every enabled sync (Google events/tasks, Apple events/tasks) back
  // to back, rather than making the person click "Sync Now" on each
  // provider card separately. Each leg is independent - one provider
  // failing (e.g. an Apple connection missing its password) doesn't stop
  // the others from running, and the summary reports both successes and
  // failures instead of masking a partial failure as a silent success.
  const handleSyncAll = async () => {
    const jobs: { label: string; run: () => Promise<unknown> }[] = []

    if (googleConnection?.syncEnabled) {
      jobs.push({ label: 'Google Calendar', run: () => syncNow('google') })
    }
    if (googleConnection?.syncTasks) {
      jobs.push({
        label: 'Google Tasks',
        run: async () => {
          const res = await authFetch('/api/calendar-sync/google/tasks', { method: 'POST' })
          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || 'Sync failed')
          return data
        },
      })
    }
    // externalCalendarId is only ever set once Apple's connect flow fully
    // succeeds (see app/api/calendar-sync/apple/connect) - a connection row
    // can have syncEnabled=true with no credentials (an incomplete/stale
    // connect attempt), and that's not "enabled", it's broken. Skip it
    // instead of running a sync that's guaranteed to fail, and skip it
    // entirely for accounts that never connected Apple at all.
    const appleFullyConnected = !!appleConnection?.externalCalendarId
    if (appleConnection?.syncEnabled && appleFullyConnected) {
      jobs.push({ label: 'Apple Calendar', run: () => syncNow('apple') })
    }
    if (appleConnection?.syncTasks && appleFullyConnected) {
      jobs.push({
        label: 'Apple Reminders',
        run: async () => {
          const res = await authFetch('/api/calendar-sync/apple/tasks', { method: 'POST' })
          const data = await res.json()
          if (!res.ok || !data.success) throw new Error(data.error || 'Sync failed')
          return data
        },
      })
    }

    if (jobs.length === 0) {
      toast.error('No sync is enabled yet - connect or turn on a calendar below first')
      return
    }

    setIsSyncingAll(true)
    const failures: string[] = []
    for (const job of jobs) {
      try {
        await job.run()
      } catch (err) {
        failures.push(`${job.label}: ${err instanceof Error ? err.message : 'Sync failed'}`)
      }
    }
    setIsSyncingAll(false)

    if (failures.length === 0) {
      toast.success(`Synced ${jobs.length} source${jobs.length > 1 ? 's' : ''}`)
    } else if (failures.length === jobs.length) {
      toast.error(failures[0])
    } else {
      toast.error(`${jobs.length - failures.length}/${jobs.length} synced. ${failures[0]}`)
    }
  }

  // Subscription link for Apple Calendar, Outlook, and any other app that
  // can subscribe to a calendar via URL (rather than a Google-style OAuth
  // integration built per-provider).
  const [icalFeedUrl, setIcalFeedUrl] = useState<string | null>(null)
  const [icalLoading, setIcalLoading] = useState(true)
  const [icalGenerating, setIcalGenerating] = useState(false)
  const [icalCopied, setIcalCopied] = useState(false)

  useEffect(() => {
    const loadIcalFeed = async () => {
      try {
        const res = await authFetch('/api/calendar-sync/ical/generate')
        const data = await res.json()
        if (data.success) {
          setIcalFeedUrl(data.feedUrl)
        }
      } catch {
        // Leave feed unset if this fails; the button below just offers to generate one
      } finally {
        setIcalLoading(false)
      }
    }
    loadIcalFeed()
  }, [])

  const handleGenerateIcalFeed = async () => {
    setIcalGenerating(true)
    try {
      const res = await authFetch('/api/calendar-sync/ical/generate', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.success) {
        setIcalFeedUrl(data.feedUrl)
        toast.success('Subscription link created')
      } else {
        toast.error(data.error || 'Failed to create subscription link')
      }
    } catch {
      toast.error('Failed to create subscription link')
    } finally {
      setIcalGenerating(false)
    }
  }

  const handleCopyIcalFeed = async () => {
    if (!icalFeedUrl) return
    try {
      await navigator.clipboard.writeText(icalFeedUrl)
      setIcalCopied(true)
      toast.success('Link copied')
      setTimeout(() => setIcalCopied(false), 2000)
    } catch {
      toast.error('Failed to copy link')
    }
  }

  // Initialize task sync state from connection
  useEffect(() => {
    if (googleConnection?.syncTasks !== undefined) {
      setTaskSyncEnabled(googleConnection.syncTasks)
    }
  }, [googleConnection?.syncTasks])

  const handleToggleTaskSync = async (enabled: boolean) => {
    setIsTogglingTaskSync(true)
    try {
      const res = await fetch('/api/calendar-sync/google/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncTasks: enabled }),
      })
      const data = await res.json()
      if (data.success) {
        setTaskSyncEnabled(enabled)
        setStatusMessage({ 
          type: 'success', 
          message: enabled ? 'Task sync enabled - tasks will sync to Google Tasks' : 'Task sync disabled' 
        })
      } else {
        throw new Error(data.error)
      }
    } catch (err) {
      setStatusMessage({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Failed to update task sync' 
      })
    } finally {
      setIsTogglingTaskSync(false)
    }
  }

  const handleSyncTasksNow = async () => {
    try {
      const res = await fetch('/api/calendar-sync/google/tasks', {
        method: 'POST',
      })
      const data = await res.json()
      if (data.success) {
        setStatusMessage({ type: 'success', message: data.message })
      } else {
        throw new Error(data.error)
      }
    } catch (err) {
      setStatusMessage({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Failed to sync tasks' 
      })
    }
  }

  // Handle URL params for success/error messages
  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')

    if (success === 'google') {
      setStatusMessage({ type: 'success', message: 'Google Calendar connected successfully!' })
    } else if (error) {
      const errorMessages: Record<string, string> = {
        denied: 'Calendar access was denied',
        missing_params: 'Missing required parameters',
        invalid_state: 'Invalid authentication state',
        token_exchange: 'Failed to exchange token',
        callback_failed: 'Callback processing failed',
        no_family: 'You need to be part of a family before connecting a calendar',
      }
      setStatusMessage({ type: 'error', message: errorMessages[error] || 'Connection failed' })
    }

    // Clear message after 5 seconds
    if (success || error) {
      const timer = setTimeout(() => setStatusMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [searchParams])

  const handleConnectGoogle = async () => {
    try {
      await connectGoogle()
    } catch (err) {
      setStatusMessage({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Failed to connect Google Calendar' 
      })
    }
  }

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect Google Calendar?')) {
      return
    }

    try {
      await disconnect(connectionId)
      setStatusMessage({ type: 'success', message: 'Google Calendar disconnected' })
    } catch (err) {
      setStatusMessage({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Failed to disconnect' 
      })
    }
  }

  const handleSyncNow = async () => {
    try {
      const result = await syncNow('google')
      setStatusMessage({ type: 'success', message: result.message })
    } catch (err) {
      setStatusMessage({ 
        type: 'error', 
        message: err instanceof Error ? err.message : 'Sync failed' 
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner className="w-8 h-8" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-6 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0 h-9 w-9 sm:h-10 sm:w-10">
          <Link href="/settings">
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold">Calendar &amp; Task Sync</h1>
          <p className="text-sm text-muted-foreground">Connect external calendars, or import events and tasks from any app</p>
        </div>
        <Button
          onClick={handleSyncAll}
          disabled={isSyncingAll || isSyncing}
          size="sm"
          className="gap-1.5 shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncingAll ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Sync All</span>
        </Button>
      </div>

      {/* Status Message */}
      {statusMessage && (
        <div className={`p-4 rounded-lg ${
          statusMessage.type === 'success' 
            ? 'bg-green-500/10 text-green-600 border border-green-500/20' 
            : 'bg-red-500/10 text-red-600 border border-red-500/20'
        }`}>
          {statusMessage.message}
        </div>
      )}

      {/* Google Calendar */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <GoogleCalendarIcon className="w-8 h-8" />
            <div>
              <CardTitle className="text-lg">Google Calendar</CardTitle>
              <CardDescription>
                Sync events bidirectionally with Google Calendar
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {googleConnection ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="font-medium">{googleConnection.calendarName}</p>
                  <p className="text-sm text-muted-foreground">
                    {googleConnection.lastSyncedAt 
                      ? `Last synced: ${format(new Date(googleConnection.lastSyncedAt), 'MMM d, yyyy h:mm a')}`
                      : 'Never synced'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleSyncNow}
                    disabled={isSyncing}
                  >
                    {isSyncing ? (
                      <Spinner className="w-4 h-4 mr-2" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Sync Now
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleDisconnect(googleConnection.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Sync Enabled</p>
                    <p className="text-sm text-muted-foreground">Automatically sync events</p>
                  </div>
                  <Switch 
                    checked={googleConnection.syncEnabled}
                    onCheckedChange={(checked) => 
                      updateConnection(googleConnection.id, { syncEnabled: checked })
                    }
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">Sync Direction</p>
                    <p className="text-sm text-muted-foreground">Choose how events are synced</p>
                  </div>
                  <Select 
                    value={googleConnection.syncDirection}
                    onValueChange={(value) => 
                      updateConnection(googleConnection.id, { syncDirection: value })
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="import">Import only</SelectItem>
                      <SelectItem value="export">Export only</SelectItem>
                      <SelectItem value="both">Bidirectional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">Auto-Sync Frequency</p>
                    <p className="text-sm text-muted-foreground">How often to automatically check for updates while the app is open</p>
                  </div>
                  <Select
                    value={String(googleConnection.syncIntervalMinutes ?? 30)}
                    onValueChange={(value) =>
                      updateConnection(googleConnection.id, { syncIntervalMinutes: Number(value) })
                    }
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Every 1 minute</SelectItem>
                      <SelectItem value="10">Every 10 minutes</SelectItem>
                      <SelectItem value="30">Every 30 minutes</SelectItem>
                      <SelectItem value="60">Every 60 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ListTodo className="w-5 h-5 text-muted-foreground" />
                    <p className="font-medium">Task Sync to Google Tasks</p>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Sync your Togethr tasks with due dates to Google Tasks.
                    Tasks will appear in a dedicated <strong>&quot;Togethr Tasks&quot;</strong> list in the Google Tasks app and show as reminders on your Android phone.
                    Completing, editing, or adding a task directly in that list syncs back here too -
                    but changes in your other Google Tasks lists (like the default &quot;My Tasks&quot;) won&apos;t, since Togethr only watches its own list.
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={taskSyncEnabled}
                        onCheckedChange={handleToggleTaskSync}
                        disabled={isTogglingTaskSync}
                      />
                      <span className="text-sm">
                        {taskSyncEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    {taskSyncEnabled && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSyncTasksNow}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Tasks Now
                      </Button>
                    )}
                  </div>
                  {taskSyncEnabled && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-4">
                      <div>
                        <p className="font-medium text-sm">Task Auto-Sync Frequency</p>
                        <p className="text-sm text-muted-foreground">How often to automatically sync tasks</p>
                      </div>
                      <Select
                        value={String(googleConnection.taskSyncIntervalMinutes ?? 30)}
                        onValueChange={(value) =>
                          updateConnection(googleConnection.id, { taskSyncIntervalMinutes: Number(value) })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Every 1 minute</SelectItem>
                          <SelectItem value="10">Every 10 minutes</SelectItem>
                          <SelectItem value="30">Every 30 minutes</SelectItem>
                          <SelectItem value="60">Every 60 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <Button onClick={handleConnectGoogle} className="w-full sm:w-auto">
              <GoogleCalendarIcon className="w-5 h-5 mr-2" />
              Connect Google Calendar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Apple Calendar & Reminders (real bidirectional CalDAV sync) */}
      <AppleCalendarCard />

      {/* Generic .ics import - Outlook, Android, or any app that can export/publish a calendar file */}
      <ImportIcsCard />

      {/* Other Calendars (Outlook, and any app that supports calendar subscription URLs) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Other Calendars</CardTitle>
              <CardDescription>
                Subscribe from Apple Calendar, Outlook, or any app that supports calendar subscription links
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {icalLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="w-5 h-5" />
            </div>
          ) : icalFeedUrl ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input readOnly value={icalFeedUrl} className="flex-1 font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyIcalFeed} className="shrink-0">
                  {icalCopied ? (
                    <Check className="w-4 h-4 mr-2" />
                  ) : (
                    <Copy className="w-4 h-4 mr-2" />
                  )}
                  {icalCopied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                In Apple Calendar: File → New Calendar Subscription, and paste this link.
                In Outlook: Add calendar → Subscribe from web, and paste this link.
                Most apps refresh a subscribed calendar every 15-60 minutes; this is a
                one-way feed (Togethr events flow out - it doesn&apos;t import events back).
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGenerateIcalFeed}
                disabled={icalGenerating}
                className="text-muted-foreground"
              >
                {icalGenerating ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Regenerate link (invalidates the old one)
              </Button>
            </>
          ) : (
            <Button onClick={handleGenerateIcalFeed} disabled={icalGenerating} className="w-full sm:w-auto">
              {icalGenerating ? <Spinner className="w-4 h-4 mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
              Create subscription link
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Samsung Calendar & Reminders - Samsung has no public Calendar/Samsung
          Cloud API for third-party apps to connect to (unlike Google's OAuth
          or Apple's CalDAV), so there's no "Connect" button here the way
          there is above. This reuses the exact same subscription feed as
          the "Other Calendars" card below - same link, same token - just
          presented with Samsung-specific setup steps, since Samsung's own
          Calendar app only displays calendars that come in through an
          account it already syncs (Samsung account or Google account), not
          a direct "subscribe by URL" option of its own. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Smartphone className="w-8 h-8 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">Samsung Calendar & Reminders</CardTitle>
              <CardDescription>
                Bring your Togethr events (and, best-effort, reminders) into Samsung Calendar
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            Samsung doesn&apos;t publish a Calendar or Samsung Cloud API for apps like Togethr to connect
            to directly, so this isn&apos;t a one-tap &quot;Connect&quot; like Google or Apple above. Instead,
            it uses the same subscription link other calendar apps use, bridged in through Google
            Calendar (which Samsung Calendar already knows how to display).
          </div>

          {icalLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="w-5 h-5" />
            </div>
          ) : icalFeedUrl ? (
            <>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input readOnly value={icalFeedUrl} className="flex-1 font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={handleCopyIcalFeed} className="shrink-0">
                  {icalCopied ? (
                    <Check className="w-4 h-4 mr-2" />
                  ) : (
                    <Copy className="w-4 h-4 mr-2" />
                  )}
                  {icalCopied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                <li>On any device, open Google Calendar (web or app) and make sure it&apos;s the same Google account your Samsung phone is signed into.</li>
                <li>On the web: <strong>Other calendars → + → From URL</strong>, and paste the link above. Give it a moment to import.</li>
                <li>On your Samsung phone: open <strong>Calendar → Menu → Manage calendars</strong>, find it listed under your Google account, and turn it on.</li>
              </ol>
              <p className="text-xs text-muted-foreground">
                This is one-way (Togethr → Samsung) and refreshes roughly every 15-60 minutes, same
                as the Other Calendars link below. Events show up reliably; reminders are included in
                the feed too, but most calendar apps - Samsung&apos;s included - don&apos;t reliably surface
                subscribed to-dos the way they do events, so treat that part as a bonus, not a guarantee.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGenerateIcalFeed}
                disabled={icalGenerating}
                className="text-muted-foreground"
              >
                {icalGenerating ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Regenerate link (invalidates the old one)
              </Button>
            </>
          ) : (
            <Button onClick={handleGenerateIcalFeed} disabled={icalGenerating} className="w-full sm:w-auto">
              {icalGenerating ? <Spinner className="w-4 h-4 mr-2" /> : <Smartphone className="w-4 h-4 mr-2" />}
              Create subscription link
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <h4 className="font-medium mb-2">About Calendar &amp; Task Sync</h4>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>• <strong>Google Calendar:</strong> Full bidirectional sync - events flow both ways automatically</li>
            <li>• <strong>Google Tasks:</strong> Tasks with due dates sync bidirectionally with a dedicated &quot;Togethr Tasks&quot; list in Google Tasks and appear as reminders on Android - only that list syncs, not your other Google Tasks lists</li>
            <li>• <strong>Apple Calendar & Reminders:</strong> Full bidirectional sync via CalDAV using your Apple ID and an app-specific password - events and reminders flow both ways automatically</li>
            <li>• <strong>Other Calendars:</strong> Outlook, and any app that supports calendar subscription links, can subscribe to a one-way feed of your Togethr events</li>
            <li>• <strong>Samsung Calendar & Reminders:</strong> No public Samsung API exists, so this uses the same subscription link, bridged through Google Calendar, to show up in Samsung&apos;s Calendar app</li>
            <li>• <strong>Import a Calendar File:</strong> Upload a .ics file (exported from Outlook, Android, iOS, or any calendar/task app) or paste a public calendar URL to bring its events and tasks into Togethr once</li>
            <li>• Auto-sync runs at your chosen frequency (1, 10, 30, or 60 minutes) while Togethr is open in a browser tab or installed app</li>
            <li>• Your calendar credentials are encrypted and stored securely</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

// One-off import of a .ics file or a public calendar URL - the path that
// actually covers "any standard calendar/task app" (Outlook, Android, iOS,
// Google Takeout exports, etc.) rather than just the two providers Togethr
// has a dedicated OAuth/CalDAV connector for. Unlike the Google/Apple cards
// above, there's no ongoing connection here: each import is a single pull,
// run again whenever the person wants to bring in a fresher export.
function ImportIcsCard() {
  const [file, setFile] = useState<File | null>(null)
  const [feedUrl, setFeedUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const runImport = async (body: FormData | { url: string }) => {
    setImporting(true)
    setResult(null)
    try {
      const res = await authFetch('/api/calendar-sync/ical/import', {
        method: 'POST',
        ...(body instanceof FormData
          ? { body }
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data.message)
        toast.success(data.message)
        setFile(null)
        setFeedUrl('')
      } else {
        toast.error(data.error || 'Import failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleFileImport = () => {
    if (!file) {
      toast.error('Choose a .ics file first')
      return
    }
    const formData = new FormData()
    formData.append('file', file)
    runImport(formData)
  }

  const handleUrlImport = () => {
    if (!feedUrl.trim()) {
      toast.error('Paste a calendar URL first')
      return
    }
    runImport({ url: feedUrl.trim() })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Upload className="w-8 h-8 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Import a Calendar File</CardTitle>
            <CardDescription>
              Bring in events and tasks from Outlook, Android, iOS, or any app that can export a .ics file
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <p className="font-medium text-sm">Upload a .ics file</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="flex-1"
            />
            <Button onClick={handleFileImport} disabled={importing || !file} className="shrink-0">
              {importing ? <Spinner className="w-4 h-4 mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            In Outlook: File → Open &amp; Export → Import/Export → Export to a file (.ics). On Android or iOS, most
            calendar apps have a similar &quot;Export calendar&quot; option.
          </p>
        </div>

        <div className="border-t pt-4 space-y-2">
          <p className="font-medium text-sm">Or paste a calendar link</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="https://... or webcal://..."
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleUrlImport} disabled={importing || !feedUrl.trim()} variant="outline" className="shrink-0">
              {importing ? <Spinner className="w-4 h-4 mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Works with a published Outlook/Google calendar link, or any public calendar subscription URL.
          </p>
        </div>

        {result && (
          <div className="p-3 rounded-lg bg-green-500/10 text-green-600 border border-green-500/20 text-sm">
            {result}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          This is a one-time pull, not an ongoing sync - run it again any time you have a fresher export.
          Re-importing the same file won&apos;t create duplicates.
        </p>
      </CardContent>
    </Card>
  )
}

// Apple's logo isn't ours to reproduce as an icon; a plain calendar glyph
// stands in for it here (see GoogleCalendarIcon above for the Google one).
function AppleCalendarCard() {
  const { appleConnection, connectApple, disconnect, updateConnection, syncNow } = useCalendarSync()
  const [appleId, setAppleId] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // A connection row can exist (syncEnabled=true) without ever having
  // stored real credentials - externalCalendarId is only set once the
  // connect flow actually succeeds. Treat that as "needs reconnecting",
  // not "connected", so the broken state doesn't masquerade as a working
  // one with controls that just fail when used.
  const isIncomplete = !!appleConnection && !appleConnection.externalCalendarId

  const handleConnect = async () => {
    if (!appleId || !appPassword) {
      toast.error('Enter your Apple ID and an app-specific password')
      return
    }
    setConnecting(true)
    try {
      await connectApple(appleId, appPassword)
      setAppleId('')
      setAppPassword('')
      toast.success('Apple Calendar connected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect Apple Calendar')
    } finally {
      setConnecting(false)
    }
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await syncNow('apple')
      toast.success('Apple Calendar synced')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Calendar className="w-8 h-8 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Apple Calendar & Reminders</CardTitle>
            <CardDescription>
              Bidirectional sync with iCloud Calendar and Reminders via CalDAV
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {appleConnection && !isIncomplete ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-medium">{appleConnection.calendarName}</p>
                <p className="text-sm text-muted-foreground">
                  {appleConnection.lastSyncedAt
                    ? `Last synced ${format(new Date(appleConnection.lastSyncedAt), 'MMM d, h:mm a')}`
                    : 'Not yet synced'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Sync Now
                </Button>
                <Button variant="ghost" size="sm" onClick={() => disconnect(appleConnection.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-medium">Sync Enabled</p>
                <p className="text-sm text-muted-foreground">Turn Apple Calendar & Reminders sync on or off</p>
              </div>
              <Switch
                checked={appleConnection.syncEnabled}
                onCheckedChange={(checked) => updateConnection(appleConnection.id, { syncEnabled: checked })}
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-medium">Auto-Sync Frequency</p>
                <p className="text-sm text-muted-foreground">How often to automatically check for updates</p>
              </div>
              <Select
                value={String(appleConnection.syncIntervalMinutes ?? 30)}
                onValueChange={(value) => updateConnection(appleConnection.id, { syncIntervalMinutes: Number(value) })}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every 1 minute</SelectItem>
                  <SelectItem value="10">Every 10 minutes</SelectItem>
                  <SelectItem value="30">Every 30 minutes</SelectItem>
                  <SelectItem value="60">Every 60 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border-t pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <ListTodo className="w-5 h-5 text-muted-foreground" />
                <p className="font-medium">Task Sync to Apple Reminders</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={appleConnection.syncTasks}
                    onCheckedChange={(checked) => updateConnection(appleConnection.id, { syncTasks: checked })}
                  />
                  <span className="text-sm">{appleConnection.syncTasks ? 'Enabled' : 'Disabled'}</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-4">
                <div>
                  <p className="font-medium text-sm">Task Auto-Sync Frequency</p>
                  <p className="text-sm text-muted-foreground">How often to automatically sync reminders</p>
                </div>
                <Select
                  value={String(appleConnection.taskSyncIntervalMinutes ?? 30)}
                  onValueChange={(value) => updateConnection(appleConnection.id, { taskSyncIntervalMinutes: Number(value) })}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Every 1 minute</SelectItem>
                    <SelectItem value="10">Every 10 minutes</SelectItem>
                    <SelectItem value="30">Every 30 minutes</SelectItem>
                    <SelectItem value="60">Every 60 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-3">
            {isIncomplete && (
              <div className="flex items-start justify-between gap-3 p-3 rounded-lg bg-yellow-500/10 text-yellow-700 border border-yellow-500/20 text-sm">
                <p>
                  This Apple connection is missing its saved password and needs to be redone -
                  enter your Apple ID and an app-specific password below to reconnect it.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 h-7 px-2 text-yellow-700 hover:text-yellow-800"
                  onClick={() => appleConnection && disconnect(appleConnection.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Apple requires an app-specific password (not your regular Apple ID password) for
              third-party apps like Togethr. Generate one at{' '}
              <a
                href="https://appleid.apple.com/account/manage"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                appleid.apple.com
              </a>{' '}
              under Sign-In and Security → App-Specific Passwords.
            </p>
            <Input
              placeholder="Apple ID (email)"
              type="email"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
            />
            <Input
              placeholder="App-specific password"
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
            />
            <Button onClick={handleConnect} disabled={connecting} className="w-full sm:w-auto">
              {connecting ? <Spinner className="w-4 h-4 mr-2" /> : <Calendar className="w-4 h-4 mr-2" />}
              Connect Apple Calendar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
