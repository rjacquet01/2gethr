'use client'

import { Suspense, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Trash2, ListTodo, Calendar, Copy, Check, Upload, Link2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { useCalendarSync } from '@/hooks/use-calendar-sync'
import { authFetch, useAuth } from '@/hooks/use-auth'
import { useFamilies, useFamily } from '@/hooks/use-family'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { toast } from 'sonner'

function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20H18C19.1046 20 20 19.1046 20 18V6C20 4.89543 19.1046 4 18 4Z" fill="#FFFFFF" stroke="#4285F4" strokeWidth="2" />
      <path d="M16 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 2V6" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 10H20" stroke="#4285F4" strokeWidth="2" />
      <rect x="7" y="13" width="3" height="3" fill="#EA4335" />
      <rect x="11" y="13" width="3" height="3" fill="#FBBC05" />
      <rect x="15" y="13" width="3" height="3" fill="#34A853" />
    </svg>
  )
}

const INTERVALS = [
  ['1', 'Every minute'],
  ['10', 'Every 10 min'],
  ['30', 'Every 30 min'],
  ['60', 'Every hour'],
] as const

function FreqSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-9 w-[150px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INTERVALS.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function StatusChip({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      <span className={cn('h-2 w-2 rounded-full', on ? 'bg-green-500' : 'bg-muted-foreground/40')} />
      {label || (on ? 'Connected' : 'Not connected')}
    </span>
  )
}

// useSearchParams() needs a Suspense boundary or the page fails to prerender.
export default function CalendarSyncPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[400px] items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <CalendarSyncContent />
    </Suspense>
  )
}

type Tab = 'accounts' | 'link' | 'import'

function CalendarSyncContent() {
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>('accounts')
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { googleConnection, appleConnection, isLoading, isSyncing, connectGoogle, disconnect, updateConnection, syncNow } = useCalendarSync()

  const [taskSyncEnabled, setTaskSyncEnabled] = useState(false)
  const [isTogglingTaskSync, setIsTogglingTaskSync] = useState(false)
  const [isSyncingAll, setIsSyncingAll] = useState(false)

  // Runs every enabled sync back to back. Each leg is independent: one
  // provider failing doesn't stop the others, and partial failure is reported.
  const handleSyncAll = async () => {
    const jobs: { label: string; run: () => Promise<unknown> }[] = []
    const taskJob = (url: string) => async () => {
      const res = await authFetch(url, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Sync failed')
      return data
    }
    if (googleConnection?.syncEnabled) jobs.push({ label: 'Google Calendar', run: () => syncNow('google') })
    if (googleConnection?.syncTasks) jobs.push({ label: 'Google Tasks', run: taskJob('/api/calendar-sync/google/tasks') })
    // externalCalendarId is only set once Apple's connect flow fully succeeds;
    // a row without it is a stale attempt, not an enabled sync.
    const appleFullyConnected = !!appleConnection?.externalCalendarId
    if (appleConnection?.syncEnabled && appleFullyConnected) jobs.push({ label: 'Apple Calendar', run: () => syncNow('apple') })
    if (appleConnection?.syncTasks && appleFullyConnected) jobs.push({ label: 'Apple Reminders', run: taskJob('/api/calendar-sync/apple/tasks') })

    if (jobs.length === 0) {
      toast.error('Nothing to sync yet - connect and turn on a calendar first')
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

    if (failures.length === 0) toast.success(`Synced ${jobs.length} source${jobs.length > 1 ? 's' : ''}`)
    else if (failures.length === jobs.length) toast.error(failures[0])
    else toast.error(`${jobs.length - failures.length}/${jobs.length} synced. ${failures[0]}`)
  }

  // Subscription link (Apple Calendar, Outlook, Samsung via Google, anything with "subscribe by URL")
  const [icalFeedUrl, setIcalFeedUrl] = useState<string | null>(null)
  const [icalLoading, setIcalLoading] = useState(true)
  const [icalGenerating, setIcalGenerating] = useState(false)
  const [icalCopied, setIcalCopied] = useState(false)
  const [icalTasksCopied, setIcalTasksCopied] = useState(false)
  const [icalIncludeTasks, setIcalIncludeTasks] = useState(true)
  const [icalIncludeReminders, setIcalIncludeReminders] = useState(true)

  useEffect(() => {
    const loadIcalFeed = async () => {
      try {
        const res = await authFetch('/api/calendar-sync/ical/generate')
        const data = await res.json()
        if (data.success) {
          setIcalFeedUrl(data.feedUrl)
          if (typeof data.includeTasks === 'boolean') setIcalIncludeTasks(data.includeTasks)
          if (typeof data.includeReminders === 'boolean') setIcalIncludeReminders(data.includeReminders)
        }
      } catch {
        // no feed yet; the UI offers to create one
      } finally {
        setIcalLoading(false)
      }
    }
    loadIcalFeed()
  }, [])

  const handleGenerateIcalFeed = async () => {
    if (icalFeedUrl && !confirm('Regenerating invalidates your current link. Calendars already subscribed will stop updating. Continue?')) return
    setIcalGenerating(true)
    try {
      const res = await authFetch('/api/calendar-sync/ical/generate', { method: 'POST' })
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

  const copyText = async (text: string, done: (v: boolean) => void, msg: string) => {
    try {
      await navigator.clipboard.writeText(text)
      done(true)
      toast.success(msg)
      setTimeout(() => done(false), 2000)
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleFeedToggle = async (key: 'includeTasks' | 'includeReminders', value: boolean) => {
    if (key === 'includeTasks') setIcalIncludeTasks(value)
    else setIcalIncludeReminders(value)
    try {
      const res = await authFetch('/api/calendar-sync/ical/generate', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      })
      const data = await res.json()
      if (!data.success) throw new Error('failed')
      toast.success('Link updated - your calendar app picks it up on its next refresh')
    } catch {
      if (key === 'includeTasks') setIcalIncludeTasks(!value)
      else setIcalIncludeReminders(!value)
      toast.error('Could not update the subscription link')
    }
  }

  useEffect(() => {
    if (googleConnection?.syncTasks !== undefined) setTaskSyncEnabled(googleConnection.syncTasks)
  }, [googleConnection?.syncTasks])

  const handleToggleTaskSync = async (enabled: boolean) => {
    setIsTogglingTaskSync(true)
    try {
      const res = await authFetch('/api/calendar-sync/google/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncTasks: enabled }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      setTaskSyncEnabled(enabled)
      toast.success(enabled ? 'Task sync on - tasks sync to Google Tasks' : 'Task sync off')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update task sync')
    } finally {
      setIsTogglingTaskSync(false)
    }
  }

  const handleSyncTasksNow = async () => {
    try {
      const res = await authFetch('/api/calendar-sync/google/tasks', { method: 'POST' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(data.message || 'Tasks synced')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync tasks')
    }
  }

  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    if (success === 'google') {
      setStatusMessage({ type: 'success', message: 'Google Calendar connected!' })
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
    if (success || error) {
      const timer = setTimeout(() => setStatusMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [searchParams])

  const handleConnectGoogle = async () => {
    try {
      await connectGoogle()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect Google Calendar')
    }
  }

  const handleDisconnect = async (connectionId: string, name: string) => {
    if (!confirm(`Disconnect ${name}?`)) return
    try {
      await disconnect(connectionId)
      toast.success(`${name} disconnected`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect')
    }
  }

  const handleSyncNow = async () => {
    try {
      const result = await syncNow('google')
      toast.success(result.message || 'Google Calendar synced')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  const appleOk = !!appleConnection && !!appleConnection.externalCalendarId
  const connectedCount = (googleConnection ? 1 : 0) + (appleOk ? 1 : 0)

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      <div className="flex items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" asChild className="h-9 w-9 shrink-0">
          <Link href="/settings" aria-label="Back to settings">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Calendar &amp; task sync</h1>
          <p className="truncate text-sm text-muted-foreground">
            {connectedCount === 0 ? 'No accounts connected' : `${connectedCount} account${connectedCount > 1 ? 's' : ''} connected`}
            {icalFeedUrl ? ' · subscription link on' : ''}
          </p>
        </div>
        <Button onClick={handleSyncAll} disabled={isSyncingAll || isSyncing} size="sm" className="shrink-0 gap-1.5">
          <RefreshCw className={cn('h-4 w-4', isSyncingAll && 'animate-spin')} />
          <span className="hidden sm:inline">Sync all</span>
        </Button>
      </div>

      {statusMessage && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border p-3 text-sm',
            statusMessage.type === 'success'
              ? 'border-green-500/20 bg-green-500/10 text-green-600'
              : 'border-red-500/20 bg-red-500/10 text-red-600'
          )}
        >
          {statusMessage.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {statusMessage.message}
        </div>
      )}

      <div className="inline-flex rounded-lg bg-muted p-1">
        {(
          [
            ['accounts', 'Accounts'],
            ['link', 'Subscription link'],
            ['import', 'Import file'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'accounts' && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {/* Google */}
          <Card className="min-w-0">
            <CardContent className="space-y-1 p-4">
              <div className="flex items-center gap-3 pb-2">
                <GoogleCalendarIcon className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Google Calendar &amp; Tasks</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {googleConnection
                      ? googleConnection.lastSyncedAt
                        ? `${googleConnection.calendarName} · synced ${format(new Date(googleConnection.lastSyncedAt), 'MMM d, h:mm a')}`
                        : `${googleConnection.calendarName} · never synced`
                      : 'Two-way sync for events and tasks'}
                  </p>
                </div>
                <StatusChip on={!!googleConnection} />
              </div>

              {googleConnection ? (
                <div className="divide-y">
                  <SettingRow label="Sync events" hint="Keep calendars in step automatically">
                    <Switch
                      checked={googleConnection.syncEnabled}
                      onCheckedChange={(checked) => updateConnection(googleConnection.id, { syncEnabled: checked })}
                    />
                  </SettingRow>
                  {googleConnection.syncEnabled && (
                    <>
                      <SettingRow label="Direction">
                        <Select
                          value={googleConnection.syncDirection}
                          onValueChange={(value) => updateConnection(googleConnection.id, { syncDirection: value })}
                        >
                          <SelectTrigger className="h-9 w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="import">Import only</SelectItem>
                            <SelectItem value="export">Export only</SelectItem>
                            <SelectItem value="both">Both ways</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                      <SettingRow label="Check for updates" hint="While the app is open">
                        <FreqSelect
                          value={googleConnection.syncIntervalMinutes ?? 30}
                          onChange={(n) => updateConnection(googleConnection.id, { syncIntervalMinutes: n })}
                        />
                      </SettingRow>
                    </>
                  )}
                  <SettingRow label="Sync tasks" hint='Uses a "Togethr Tasks" list in Google Tasks'>
                    <Switch checked={taskSyncEnabled} onCheckedChange={handleToggleTaskSync} disabled={isTogglingTaskSync} />
                  </SettingRow>
                  {taskSyncEnabled && (
                    <SettingRow label="Task check frequency">
                      <FreqSelect
                        value={googleConnection.taskSyncIntervalMinutes ?? 30}
                        onChange={(n) => updateConnection(googleConnection.id, { taskSyncIntervalMinutes: n })}
                      />
                    </SettingRow>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-3">
                    <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={isSyncing}>
                      {isSyncing ? <Spinner className="mr-1.5 h-4 w-4" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                      Sync events
                    </Button>
                    {taskSyncEnabled && (
                      <Button variant="outline" size="sm" onClick={handleSyncTasksNow}>
                        <ListTodo className="mr-1.5 h-4 w-4" />
                        Sync tasks
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => handleDisconnect(googleConnection.id, 'Google Calendar')}
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Disconnect
                    </Button>
                  </div>
                  <p className="pt-3 text-xs text-muted-foreground">
                    Only the &quot;Togethr Tasks&quot; list syncs back - other Google Tasks lists are never touched.
                  </p>
                </div>
              ) : (
                <Button onClick={handleConnectGoogle} className="w-full sm:w-auto">
                  <GoogleCalendarIcon className="mr-2 h-5 w-5" />
                  Connect Google Calendar
                </Button>
              )}
            </CardContent>
          </Card>

          <AppleCalendarCard />
        </div>
      )}

      {tab === 'link' && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <p className="font-semibold">Subscribe from any calendar app</p>
              <p className="text-xs text-muted-foreground">
                One-way feed (Togethr → your calendar) for Apple, Outlook, Android and Samsung. Apps refresh it every 15-60 minutes
                (Google a few times a day).
              </p>
            </div>

            {icalLoading ? (
              <div className="flex justify-center py-4">
                <Spinner className="h-5 w-5" />
              </div>
            ) : icalFeedUrl ? (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input readOnly value={icalFeedUrl} className="flex-1 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" size="sm" className="shrink-0" onClick={() => copyText(icalFeedUrl, setIcalCopied, 'Link copied')}>
                    {icalCopied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                    {icalCopied ? 'Copied' : 'Copy link'}
                  </Button>
                </div>

                <div className="divide-y rounded-lg border px-3">
                  <SettingRow label="Include tasks" hint="Tasks with a due date appear with an alert">
                    <Switch checked={icalIncludeTasks} onCheckedChange={(v) => handleFeedToggle('includeTasks', v)} />
                  </SettingRow>
                  <SettingRow label="Include reminders" hint="Your reminders appear at their time">
                    <Switch checked={icalIncludeReminders} onCheckedChange={(v) => handleFeedToggle('includeReminders', v)} />
                  </SettingRow>
                </div>

                <LinkInstructions />

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyText(`${icalFeedUrl}?include=tasks,reminders`, setIcalTasksCopied, 'Tasks & reminders link copied')}
                  >
                    {icalTasksCopied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                    {icalTasksCopied ? 'Copied' : 'Tasks & reminders only link'}
                  </Button>
                  <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={handleGenerateIcalFeed} disabled={icalGenerating}>
                    {icalGenerating ? <Spinner className="mr-1.5 h-4 w-4" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                    Regenerate
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Already using Apple login for events? Subscribe to the tasks &amp; reminders only link so events aren&apos;t duplicated.
                </p>
              </>
            ) : (
              <Button onClick={handleGenerateIcalFeed} disabled={icalGenerating} className="w-full sm:w-auto">
                {icalGenerating ? <Spinner className="mr-2 h-4 w-4" /> : <Calendar className="mr-2 h-4 w-4" />}
                Create subscription link
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'import' && <ImportIcsCard />}
    </div>
  )
}

const APP_STEPS: Record<string, { label: string; steps: React.ReactNode }> = {
  iphone: {
    label: 'iPhone / iPad',
    steps: <>Settings → Calendar → Accounts → Add Account → Other → <strong>Add Subscribed Calendar</strong>, then paste the link.</>,
  },
  mac: { label: 'Mac', steps: <>Calendar → File → <strong>New Calendar Subscription</strong>, then paste the link.</> },
  outlook: { label: 'Outlook', steps: <>Add calendar → <strong>Subscribe from web</strong>, then paste the link.</> },
  android: {
    label: 'Android',
    steps: <>On a computer open calendar.google.com → Other calendars (+) → <strong>From URL</strong> and paste the link. It then shows in Google Calendar on your phone.</>,
  },
  samsung: {
    label: 'Samsung',
    steps: (
      <>
        Samsung has no public calendar API, so bridge it through Google: add the link in Google Calendar on the web (<strong>Other calendars → + → From URL</strong>,
        same Google account as your phone), then on the phone open <strong>Calendar → Menu → Manage calendars</strong> and turn it on. Events are reliable;
        reminders are best-effort.
      </>
    ),
  },
}

function LinkInstructions() {
  const [app, setApp] = useState('iphone')
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">How to add it</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(APP_STEPS).map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => setApp(k)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              app === k ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{APP_STEPS[app].steps}</p>
    </div>
  )
}

// One-off import of a .ics file or public calendar URL. Not an ongoing sync.
function ImportIcsCard() {
  const [file, setFile] = useState<File | null>(null)
  const [feedUrl, setFeedUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [assignUserIds, setAssignUserIds] = useState<string[]>([])
  const [assignChildIds, setAssignChildIds] = useState<string[]>([])

  const { user } = useAuth()
  // The family being viewed (switcher choice), not the account's owned family:
  // the import, the people offered and the role all come from it.
  const { families } = useFamilies()
  const importFamilyId = families[0]?.id ?? null
  const { family } = useFamily(importFamilyId)
  const myRole = (family?.members || []).find((m) => m.userId === user?.id)?.role
  // Matches the import route: grown-up members (parent/guardian/adult) can assign.
  const canAssign = myRole === 'PARENT' || myRole === 'GUARDIAN' || myRole === 'ADULT'
  const toggleId = (list: string[], id: string, on: boolean) => (on ? Array.from(new Set([...list, id])) : list.filter((x) => x !== id))

  const runImport = async (body: FormData | { url: string }) => {
    setImporting(true)
    setResult(null)
    try {
      if (body instanceof FormData) {
        body.append('assignUserIds', JSON.stringify(assignUserIds))
        body.append('assignChildIds', JSON.stringify(assignChildIds))
      }
      const importUrl = importFamilyId
        ? `/api/calendar-sync/ical/import?familyId=${encodeURIComponent(importFamilyId)}`
        : '/api/calendar-sync/ical/import'
      const res = await authFetch(importUrl, {
        method: 'POST',
        ...(body instanceof FormData
          ? { body }
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, assignUserIds, assignChildIds }) }),
      })
      const data = await res.json()
      if (data.success) {
        setResult(data.message)
        toast.success(data.message)
        setFile(null)
        setFeedUrl('')
        setAssignUserIds([])
        setAssignChildIds([])
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
    if (!file) return toast.error('Choose a .ics file first')
    const formData = new FormData()
    formData.append('file', file)
    runImport(formData)
  }

  const handleUrlImport = () => {
    if (!feedUrl.trim()) return toast.error('Paste a calendar URL first')
    runImport({ url: feedUrl.trim() })
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div>
          <p className="font-semibold">Import a calendar file</p>
          <p className="text-xs text-muted-foreground">
            One-time import of events and tasks from Outlook, Android, iOS or any app that exports .ics. Re-importing the same file won&apos;t create duplicates.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Upload a .ics file</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input type="file" accept=".ics,text/calendar" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="flex-1" />
              <Button onClick={handleFileImport} disabled={importing || !file} className="shrink-0">
                {importing ? <Spinner className="mr-1.5 h-4 w-4" /> : <Upload className="mr-1.5 h-4 w-4" />}
                Import
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Outlook: File → Open &amp; Export → Import/Export → Export to a file (.ics).</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Or paste a calendar link</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input placeholder="https://... or webcal://..." value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} className="flex-1" />
              <Button onClick={handleUrlImport} disabled={importing || !feedUrl.trim()} variant="outline" className="shrink-0">
                {importing ? <Spinner className="mr-1.5 h-4 w-4" /> : <Link2 className="mr-1.5 h-4 w-4" />}
                Import
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">A published Outlook/Google link or any public subscription URL.</p>
          </div>
        </div>

        {canAssign && family && (
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">
              Assign imported events to people (optional)
              {assignUserIds.length + assignChildIds.length > 0 && (
                <span className="ml-2 text-xs text-muted-foreground">{assignUserIds.length + assignChildIds.length} selected</span>
              )}
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Everyone in the family can see imported events. Pick people to also assign every event in the file to them; children get a push, email and text.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(family.members || [])
                .filter((m) => m.isActive !== false && m.userId)
                .map((m) => (
                  <div key={m.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`import-assign-${m.id}`}
                      checked={assignUserIds.includes(m.userId)}
                      onCheckedChange={(c) => setAssignUserIds((prev) => toggleId(prev, m.userId, !!c))}
                    />
                    <label htmlFor={`import-assign-${m.id}`} className="cursor-pointer text-sm">
                      {m.displayName} <span className="text-xs capitalize text-muted-foreground">({m.role.toLowerCase()})</span>
                    </label>
                  </div>
                ))}
              {(family.children || [])
                .filter((c) => !c.hasLogin)
                .map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`import-assign-child-${c.id}`}
                      checked={assignChildIds.includes(c.id)}
                      onCheckedChange={(on) => setAssignChildIds((prev) => toggleId(prev, c.id, !!on))}
                    />
                    <label htmlFor={`import-assign-child-${c.id}`} className="cursor-pointer text-sm">
                      {c.displayName} <span className="text-xs text-muted-foreground">(child)</span>
                    </label>
                  </div>
                ))}
            </div>
          </details>
        )}

        {result && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-600">{result}</div>
        )}
      </CardContent>
    </Card>
  )
}

function AppleCalendarCard() {
  const { appleConnection, connectApple, disconnect, updateConnection, syncNow } = useCalendarSync()
  const [appleId, setAppleId] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // A row can exist without credentials; externalCalendarId is only set once
  // connect succeeds. Treat that as "needs reconnecting".
  const isIncomplete = !!appleConnection && !appleConnection.externalCalendarId
  const connected = !!appleConnection && !isIncomplete

  const handleConnect = async () => {
    if (!appleId || !appPassword) {
      toast.error('Enter your Apple ID and an app-specific password')
      return
    }
    setConnecting(true)
    try {
      const result = (await connectApple(appleId, appPassword)) as { remindersNote?: string | null }
      setAppleId('')
      setAppPassword('')
      toast.success('Apple Calendar connected')
      if (result?.remindersNote) toast.info(result.remindersNote)
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
    <Card className="min-w-0">
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-3 pb-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Calendar className="h-5 w-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Apple Calendar &amp; Reminders</p>
            <p className="truncate text-xs text-muted-foreground">
              {connected
                ? appleConnection!.lastSyncedAt
                  ? `${appleConnection!.calendarName} · synced ${format(new Date(appleConnection!.lastSyncedAt), 'MMM d, h:mm a')}`
                  : `${appleConnection!.calendarName} · not yet synced`
                : 'Two-way iCloud sync via CalDAV'}
            </p>
          </div>
          <StatusChip on={connected} label={isIncomplete ? 'Needs reconnect' : undefined} />
        </div>

        {connected ? (
          <div className="divide-y">
            <SettingRow label="Sync events" hint="Calendar & Reminders sync on or off">
              <Switch checked={appleConnection!.syncEnabled} onCheckedChange={(checked) => updateConnection(appleConnection!.id, { syncEnabled: checked })} />
            </SettingRow>
            {appleConnection!.syncEnabled && (
              <SettingRow label="Check for updates" hint="While the app is open">
                <FreqSelect value={appleConnection!.syncIntervalMinutes ?? 30} onChange={(n) => updateConnection(appleConnection!.id, { syncIntervalMinutes: n })} />
              </SettingRow>
            )}
            <SettingRow label="Sync tasks & reminders" hint="Two-way with Apple Reminders">
              <Switch checked={appleConnection!.syncTasks} onCheckedChange={(checked) => updateConnection(appleConnection!.id, { syncTasks: checked })} />
            </SettingRow>
            {appleConnection!.syncTasks && (
              <SettingRow label="Task check frequency">
                <FreqSelect value={appleConnection!.taskSyncIntervalMinutes ?? 30} onChange={(n) => updateConnection(appleConnection!.id, { taskSyncIntervalMinutes: n })} />
              </SettingRow>
            )}
            {appleConnection!.appleTasksAvailable === false && (
              <p className="my-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-700">
                Apple didn&apos;t share a Reminders list with Togethr (lists upgraded in iOS 13+ aren&apos;t available to other apps). Use the Subscription link tab to see tasks on your iPhone.
              </p>
            )}
            <div className="flex items-center gap-2 pt-3">
              <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing}>
                {syncing ? <Spinner className="mr-1.5 h-4 w-4" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
                Sync now
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm('Disconnect Apple Calendar?')) disconnect(appleConnection!.id)
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {isIncomplete && (
              <p className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3 text-sm text-yellow-700">
                Apple login isn&apos;t finished - enter your Apple ID and an app-specific password below. (Your subscription link keeps working.)
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Apple needs an app-specific password, not your regular one. Create it at{' '}
              <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer" className="underline">
                appleid.apple.com
              </a>{' '}
              → Sign-In and Security → App-Specific Passwords.
            </p>
            <Input placeholder="Apple ID (email)" type="email" autoComplete="off" value={appleId} onChange={(e) => setAppleId(e.target.value)} />
            <Input placeholder="App-specific password" type="password" autoComplete="new-password" value={appPassword} onChange={(e) => setAppPassword(e.target.value)} />
            <Button onClick={handleConnect} disabled={connecting} className="w-full sm:w-auto">
              {connecting ? <Spinner className="mr-2 h-4 w-4" /> : <Calendar className="mr-2 h-4 w-4" />}
              Connect Apple Calendar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
