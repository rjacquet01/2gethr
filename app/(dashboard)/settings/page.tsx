'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth, clearTokens, authFetch } from '@/hooks/use-auth'
import { useFamilies } from '@/hooks/use-family'
import { useSubscription } from '@/hooks/use-subscription'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { TwoFactorSettings } from '@/components/two-factor-settings'
import { ChangePasswordButton } from '@/components/change-password-dialog'
import { ActiveSessions } from '@/components/active-sessions'
import { usePushNotifications } from '@/hooks/use-push-notifications'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Bell, Lock, Shield, Globe, User, Camera, Trash2, Phone, Smartphone, Download, RotateCcw, Sun, Moon, RefreshCw, ChevronRight, Mail } from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function Row({ label, hint, htmlFor, children, badge }: { label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
  <div className="flex items-center justify-between gap-4 py-3">
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={htmlFor} className="text-sm font-medium">{label}</Label>
        {badge}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)
}

export default function SettingsPage() {
  const { user, mutate } = useAuth()
  const router = useRouter()
  const { families } = useFamilies()
  const primaryFamily = families[0] || null
  const { access, isLoading: tierLoading } = useSubscription(primaryFamily?.id || null)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const pushNotifications = usePushNotifications()
  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState<'profile' | 'notifications' | 'security' | 'preferences' | 'account'>('profile')
  const [uploading, setUploading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Profile data
  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    phone: '',
  })
  
  // Handle hydration for theme
  useEffect(() => {
    setMounted(true)
  }, [])
  
  // Load profile data from user
  useEffect(() => {
    if (user) {
      setProfile({
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        phone: user.phone || '',
      })
    }
  }, [user])
  
  const [settings, setSettings] = useState({
    emailNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    phoneAlerts: false,
    eventReminders: true,
    locationAlerts: true,
    weeklyDigest: false,
    darkMode: false,
    language: 'en',
  })
  const [settingsLoading, setSettingsLoading] = useState(true)
  // Default reminder times (minutes before an event) that pre-fill the
  // reminders on every new event. Saved to reminder_settings.default_reminder_minutes.
  const [defaultReminders, setDefaultReminders] = useState<number[]>([15])
  const [exporting, setExporting] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showResetDialog, setShowResetDialog] = useState(false)
  const [resetConfirmEmail, setResetConfirmEmail] = useState('')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  
  // Load notification settings from database
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await authFetch('/api/user/notification-settings')
        if (res.ok) {
          const data = await res.json()
          if (data.data) {
            setSettings(prev => ({
              ...prev,
              emailNotifications: data.data.emailNotifications ?? true,
              pushNotifications: data.data.pushNotifications ?? true,
              smsNotifications: data.data.smsNotifications ?? false,
              phoneAlerts: data.data.phoneAlerts ?? false,
              weeklyDigest: data.data.weeklyDigest ?? false,
            }))
            if (Array.isArray(data.data.defaultReminderMinutes)) {
              setDefaultReminders(data.data.defaultReminderMinutes)
            }
          }
        }
      } catch {
        // Use defaults if loading fails
      } finally {
        setSettingsLoading(false)
      }
    }
    if (user) loadSettings()
  }, [user])

  // The database preference and the browser's actual push subscription can
  // drift apart (e.g. the toggle was saved "on" before this device ever
  // granted permission, or the person revoked notifications in their browser
  // settings). Once we know the real subscription state, reflect it rather
  // than trusting the stored flag blindly.
  useEffect(() => {
    if (!pushNotifications.isLoading && !settingsLoading) {
      setSettings(prev =>
        prev.pushNotifications === pushNotifications.isSubscribed
          ? prev
          : { ...prev, pushNotifications: pushNotifications.isSubscribed }
      )
    }
  }, [pushNotifications.isLoading, pushNotifications.isSubscribed, settingsLoading])

  // Read the real per-capability flags for the family's tier (see
  // lib/subscription-tiers.ts) instead of hardcoding which tier names
  // happen to include SMS/phone alerts today.
  const hasSmsFeature = !!access?.featureFlags.smsNotifications
  // Texts used this month vs the plan's allowance (only fetched on the Notifications tab).
  const { data: smsUsage } = useSWR<{ used: number; quota: number; trial: boolean }>(
    tab === 'notifications' && hasSmsFeature && primaryFamily?.id ? `/api/families/${primaryFamily.id}/sms-usage` : null,
    async (url: string) => {
      const res = await authFetch(url)
      if (!res.ok) throw new Error('Failed to load SMS usage')
      return (await res.json()).data
    }
  )
  const hasPhoneAlerts = !!access?.featureFlags.phoneAlerts

  const handleToggle = async (key: keyof typeof settings) => {
    const newValue = !settings[key]

    // Push notifications need more than a database flag: the browser has to
    // actually grant permission and create a Push subscription (or tear one
    // down) before we persist the preference, otherwise the toggle looks "on"
    // with nothing behind it.
    if (key === 'pushNotifications') {
      if (newValue) {
        if (!pushNotifications.isSupported) {
          toast.error('Push notifications are not supported in this browser')
          return
        }
        const ok = await pushNotifications.subscribe()
        if (!ok) {
          toast.error(
            pushNotifications.error === 'Notification permission denied'
              ? 'Notification permission was denied. Enable notifications for this site in your browser settings, then try again.'
              : pushNotifications.error || 'Failed to enable push notifications'
          )
          return
        }
      } else {
        await pushNotifications.unsubscribe()
      }
    }

    setSettings(prev => ({ ...prev, [key]: newValue }))

    // Save notification settings to database
    if (['emailNotifications', 'pushNotifications', 'smsNotifications', 'phoneAlerts', 'weeklyDigest'].includes(key)) {
      try {
        const res = await authFetch('/api/user/notification-settings', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            emailNotifications: key === 'emailNotifications' ? newValue : settings.emailNotifications,
            pushNotifications: key === 'pushNotifications' ? newValue : settings.pushNotifications,
            smsNotifications: key === 'smsNotifications' ? newValue : settings.smsNotifications,
            phoneAlerts: key === 'phoneAlerts' ? newValue : settings.phoneAlerts,
            weeklyDigest: key === 'weeklyDigest' ? newValue : settings.weeklyDigest,
          }),
        })
        if (!res.ok) throw new Error('Failed to save setting')
        toast.success('Setting updated')
      } catch {
        // Revert on error
        setSettings(prev => ({ ...prev, [key]: !newValue }))
        toast.error('Failed to save setting')
      }
    }
  }

  const DEFAULT_REMINDER_CHOICES = [
    { value: 0, label: 'At time of event' },
    { value: 5, label: '5 minutes before' },
    { value: 15, label: '15 minutes before' },
    { value: 30, label: '30 minutes before' },
    { value: 60, label: '1 hour before' },
    { value: 120, label: '2 hours before' },
    { value: 1440, label: '1 day before' },
  ]

  const handleToggleDefaultReminder = async (minutes: number, checked: boolean) => {
    const previous = defaultReminders
    const next = checked
      ? [...previous, minutes].sort((a, b) => a - b)
      : previous.filter(m => m !== minutes)
    setDefaultReminders(next)
    try {
      const res = await authFetch('/api/user/notification-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultReminderMinutes: next }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Default reminders updated')
    } catch {
      setDefaultReminders(previous)
      toast.error('Failed to save default reminders')
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.')
      return
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB.')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await authFetch('/api/auth/profile/photo', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to upload photo')
        return
      }

      toast.success('Profile photo updated!')
      mutate() // Refresh user data
    } catch {
      toast.error('Failed to upload photo')
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handlePhotoDelete = async () => {
    if (!confirm('Are you sure you want to delete your profile photo?')) return

    setUploading(true)
    try {
      const res = await authFetch('/api/auth/profile/photo', {
        method: 'DELETE',
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete photo')
        return
      }

      toast.success('Profile photo deleted')
      mutate() // Refresh user data
    } catch {
      toast.error('Failed to delete photo')
    } finally {
      setUploading(false)
    }
  }

  const userInitials = user ? `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() : 'U'

  const handleSaveProfile = async () => {
    setSavingProfile(true)
    try {
      const res = await authFetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone || null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to update profile')
        return
      }

      toast.success('Profile updated successfully')
      mutate() // Refresh user data
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleExportData = async (format: 'xlsx' | 'json' = 'xlsx') => {
    setExporting(true)
    try {
      const res = await authFetch(`/api/user/export?format=${format}`)
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.details || errorData.error || 'Failed to export data')
      }
      
      // Create blob and download
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `account-export-${new Date().toISOString().split('T')[0]}.${format}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      
      toast.success('Account data exported successfully')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export data')
    } finally {
      setExporting(false)
    }
  }

  const handleResetAccount = async () => {
    if (resetConfirmEmail !== user?.email) {
      toast.error('Email does not match your account email')
      return
    }
    
    setResetting(true)
    try {
      const res = await authFetch('/api/account/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: resetConfirmEmail }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to reset account')
      }
      
      toast.success('Account has been reset. You can now set up your profile again.')
      setShowResetDialog(false)
      setResetConfirmEmail('')
      mutate() // Refresh user data
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset account')
    } finally {
      setResetting(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmEmail !== user?.email) {
      toast.error('Email does not match your account email')
      return
    }

    setDeleting(true)
    try {
      const res = await authFetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEmail: deleteConfirmEmail }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete account')
      }

      toast.success('Your account has been deleted.')
      // Clear the client-side tokens (the API call already cleared the
      // server-side auth cookies) and send the person to login - there's
      // no account left to come back to.
      clearTokens()
      setShowDeleteDialog(false)
      router.push('/login')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  const TABS = [
    ['profile', 'Profile', User],
    ['notifications', 'Notifications', Bell],
    ['security', 'Security', Lock],
    ['preferences', 'Preferences', Globe],
    ['account', 'Account', Shield],
  ] as const

  return (
    <div className="space-y-4 pb-20 sm:space-y-5 lg:pb-0">
      <div className="flex items-center gap-3">
        <Avatar className="h-11 w-11">
          <AvatarImage src={user?.avatarUrl || undefined} alt={user?.displayName || 'User'} />
          <AvatarFallback className="bg-primary/10 text-primary">{userInitials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Settings</h1>
          <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Calendar sync shortcut */}
      <Link
        href="/settings/calendar-sync"
        className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
          <RefreshCw className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Calendar &amp; task sync</p>
          <p className="truncate text-xs text-muted-foreground">Google, Apple, subscription link or .ics import</p>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Tabs */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div className="inline-flex rounded-lg bg-muted p-1">
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              <span className={cn(tab === key ? '' : 'hidden sm:inline')}>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'profile' && (
        <Card>
          <CardContent className="space-y-5 p-4 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={user?.avatarUrl || undefined} alt={user?.displayName || 'User'} />
                  <AvatarFallback className="bg-primary/10 text-2xl text-primary">{userInitials}</AvatarFallback>
                </Avatar>
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/80">
                    <Spinner className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="flex flex-col items-start gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="photo-upload"
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                    <Camera className="mr-1.5 h-4 w-4" />
                    {user?.avatarUrl ? 'Change' : 'Upload photo'}
                  </Button>
                  {user?.avatarUrl && (
                    <Button variant="ghost" size="sm" onClick={handlePhotoDelete} disabled={uploading} className="text-destructive hover:text-destructive">
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF. Max 5MB.</p>
              </div>
            </div>

            <Separator />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="phone">Phone</Label>
                  {hasSmsFeature ? (
                    <Badge variant="secondary" className="text-xs">
                      <Smartphone className="mr-1 h-3 w-3" />
                      SMS enabled
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Upgrade for SMS</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <Input id="phone" type="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} placeholder="+1 (555) 123-4567" className="flex-1" />
                </div>
                <p className="text-xs text-muted-foreground">
                  {hasSmsFeature ? 'Used for SMS notifications and alerts.' : 'Add a number now; SMS alerts need the Plus or Premium plan.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? <Spinner className="mr-2 h-4 w-4" /> : null}
                Save profile
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'notifications' && (
        <Card>
          <CardContent className="divide-y p-4 sm:px-6 sm:py-2">
            <Row label="Email" htmlFor="email-notifications" hint="Updates by email">
              <Switch id="email-notifications" checked={settings.emailNotifications} onCheckedChange={() => handleToggle('emailNotifications')} />
            </Row>
            <Row label="Push" htmlFor="push-notifications" hint="Notifications on this device">
              <Switch id="push-notifications" checked={settings.pushNotifications} onCheckedChange={() => handleToggle('pushNotifications')} />
            </Row>
            <Row
              label="SMS"
              htmlFor="sms-notifications"
              badge={!hasSmsFeature ? <Badge variant="outline" className="text-xs">Plus+</Badge> : undefined}
              hint={
                !hasSmsFeature ? (
                  'Upgrade to Plus or Premium for text alerts'
                ) : !profile.phone ? (
                  <span className="text-amber-600">Add a phone number in Profile first</span>
                ) : smsUsage ? (
                  <span className={smsUsage.used >= smsUsage.quota ? 'text-amber-600' : undefined}>
                    SMS this month: {smsUsage.used} of {smsUsage.quota}
                    {smsUsage.trial ? ' (trial)' : ''}
                    {smsUsage.used >= smsUsage.quota ? ' - texts resume next month; push and email still arrive' : ''}
                  </span>
                ) : (
                  'Text message alerts'
                )
              }
            >
              {!hasSmsFeature ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/subscription">Upgrade</Link>
                </Button>
              ) : (
                <Switch id="sms-notifications" checked={settings.smsNotifications} onCheckedChange={() => handleToggle('smsNotifications')} disabled={!profile.phone} />
              )}
            </Row>
            <Row label="Event reminders" htmlFor="event-reminders" hint="Remind me before events start">
              <Switch id="event-reminders" checked={settings.eventReminders} onCheckedChange={() => handleToggle('eventReminders')} />
            </Row>
            <Row label="Location alerts" htmlFor="location-alerts" hint="Geofence and location alerts">
              <Switch id="location-alerts" checked={settings.locationAlerts} onCheckedChange={() => handleToggle('locationAlerts')} />
            </Row>
            <Row label="Weekly digest" htmlFor="weekly-digest" hint="A weekly summary email">
              <Switch id="weekly-digest" checked={settings.weeklyDigest} onCheckedChange={() => handleToggle('weeklyDigest')} />
            </Row>
            <div className="space-y-3 py-3">
              <div>
                <Label className="text-sm font-medium">Default reminder times</Label>
                <p className="text-xs text-muted-foreground">New events start with these selected. You can change them per event.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEFAULT_REMINDER_CHOICES.map((opt) => {
                  const locked = !tierLoading && !access?.featureFlags.customReminderTimes && opt.value !== 15
                  return (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox
                        id={`default-reminder-${opt.value}`}
                        checked={defaultReminders.includes(opt.value)}
                        onCheckedChange={(checked) => handleToggleDefaultReminder(opt.value, checked === true)}
                        disabled={settingsLoading || locked}
                      />
                      <label htmlFor={`default-reminder-${opt.value}`} className="cursor-pointer text-sm">
                        {opt.label}{locked ? ' (Plus)' : ''}
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'security' && (
        <Card>
          <CardContent className="space-y-1 p-4 sm:px-6 sm:py-3">
            <Row label="Password" hint="Change your account password">
              <ChangePasswordButton />
            </Row>
            <Separator />
            <div className="py-3">
              <TwoFactorSettings />
            </div>
            <Separator />
            <div className="py-3">
              <ActiveSessions />
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'preferences' && (
        <Card>
          <CardContent className="divide-y p-4 sm:px-6 sm:py-2">
            <Row
              label="Dark mode"
              htmlFor="dark-mode"
              hint="Use the dark theme"
            >
              <div className="flex items-center gap-2">
                {mounted && resolvedTheme === 'dark' ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
                <Switch id="dark-mode" checked={mounted ? resolvedTheme === 'dark' : false} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
              </div>
            </Row>
            <Row label="Language" hint="Your preferred language">
              <select
                value={settings.language}
                onChange={(e) => setSettings((prev) => ({ ...prev, language: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </select>
            </Row>
          </CardContent>
        </Card>
      )}

      {tab === 'account' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:px-6 sm:py-3">
              <Row
                label="Export my data"
                hint="Profile, families, locations, events, tasks, reminders, notifications, SOS alerts, billing and activity. Excel to read, JSON for a complete copy."
              >
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleExportData('xlsx')} disabled={exporting}>
                    {exporting ? <Spinner className="mr-1.5 h-4 w-4" /> : <Download className="mr-1.5 h-4 w-4" />}
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExportData('json')} disabled={exporting}>
                    JSON
                  </Button>
                </div>
              </Row>
            </CardContent>
          </Card>

          <Card className="border-destructive/40">
            <CardContent className="divide-y p-4 sm:px-6 sm:py-2">
              <p className="flex items-center gap-2 pb-2 text-sm font-semibold text-destructive sm:pt-2">
                <Shield className="h-4 w-4" />
                Danger zone
              </p>
              <Row label="Reset account" hint="Clear all data and start fresh (keeps your login)">
                <Button variant="outline" size="sm" className="border-amber-600 text-amber-600 hover:bg-amber-50" onClick={() => setShowResetDialog(true)}>
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Reset
                </Button>
              </Row>
              <Row label="Delete account" hint="Permanently delete your account and all data">
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Delete
                </Button>
              </Row>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delete Account Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-destructive">Delete Account</DialogTitle>
              <DialogDescription>
                This permanently deletes your account. Your profile, contact info, notifications,
                location history, and favorites are erased, you&apos;ll be removed from every family,
                and any subscription you own with no other members will be cancelled. This cannot
                be undone and you will not be able to log back in with this email.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm font-medium">
                To confirm, please type your email address: <span className="text-muted-foreground">{user?.email}</span>
              </p>
              <Input
                placeholder="Enter your email to confirm"
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowDeleteDialog(false)
                setDeleteConfirmEmail('')
              }}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteAccount}
                disabled={deleting || deleteConfirmEmail !== user?.email}
              >
                {deleting ? <Spinner className="w-4 h-4 mr-2" /> : null}
                Permanently Delete Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reset Account Dialog */}
        <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-amber-600">Reset Account</DialogTitle>
              <DialogDescription>
                This will delete all your data including events, tasks, family memberships, 
                notifications, and location history. Your login credentials will be kept so 
                you can set up your account again with new information.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm font-medium">
                To confirm, please type your email address: <span className="text-muted-foreground">{user?.email}</span>
              </p>
              <Input
                placeholder="Enter your email to confirm"
                value={resetConfirmEmail}
                onChange={(e) => setResetConfirmEmail(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setShowResetDialog(false)
                setResetConfirmEmail('')
              }}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleResetAccount}
                disabled={resetting || resetConfirmEmail !== user?.email}
              >
                {resetting ? <Spinner className="w-4 h-4 mr-2" /> : null}
                Reset Account
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

    </div>
  )
}
