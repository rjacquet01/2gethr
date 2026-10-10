'use client'

import { useState, useRef, useEffect } from 'react'
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
import { Bell, Lock, Shield, Globe, User, Camera, Trash2, Phone, Smartphone, Download, RotateCcw, Sun, Moon, RefreshCw } from 'lucide-react'
import { useTheme } from 'next-themes'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export default function SettingsPage() {
  const { user, mutate } = useAuth()
  const router = useRouter()
  const { families } = useFamilies()
  const primaryFamily = families[0] || null
  const { access } = useSubscription(primaryFamily?.id || null)
  const { theme, setTheme, resolvedTheme } = useTheme()
  const pushNotifications = usePushNotifications()
  const [mounted, setMounted] = useState(false)
  const [saving, setSaving] = useState(false)
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

  const handleSave = async () => {
    setSaving(true)
    try {
      // In production, this would save to the API
      await new Promise(resolve => setTimeout(resolve, 500))
      toast.success('Settings saved successfully')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account preferences</p>
      </div>

      <div className="grid gap-6">
        {/* Profile Photo */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile Photo
            </CardTitle>
            <CardDescription>
              Upload a profile photo to personalize your account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="relative">
                <Avatar className="h-24 w-24">
                  <AvatarImage 
                    src={user?.avatarUrl || undefined} 
                    alt={user?.displayName || 'User'} 
                  />
                  <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                    {userInitials}
                  </AvatarFallback>
                </Avatar>
                {uploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-full">
                    <Spinner className="h-6 w-6" />
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  id="photo-upload"
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  {user?.avatarUrl ? 'Change Photo' : 'Upload Photo'}
                </Button>
                {user?.avatarUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handlePhotoDelete}
                    disabled={uploading}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Remove Photo
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  JPEG, PNG, WebP or GIF. Max 5MB.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile Information
            </CardTitle>
            <CardDescription>
              Update your personal details and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={profile.firstName}
                  onChange={(e) => setProfile(prev => ({ ...prev, firstName: e.target.value }))}
                  placeholder="Enter your first name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={profile.lastName}
                  onChange={(e) => setProfile(prev => ({ ...prev, lastName: e.target.value }))}
                  placeholder="Enter your last name"
                />
              </div>
            </div>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="phone">Phone Number</Label>
                {hasSmsFeature ? (
                  <Badge variant="secondary" className="text-xs">
                    <Smartphone className="h-3 w-3 mr-1" />
                    SMS Enabled
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Upgrade for SMS
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={(e) => setProfile(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="+1 (555) 123-4567"
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {hasSmsFeature 
                  ? 'Your phone number will be used for SMS notifications and alerts.'
                  : 'Add your phone number to receive SMS notifications. Upgrade to Basic or Premium to enable SMS alerts.'
                }
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} disabled={savingProfile}>
                {savingProfile ? <Spinner className="h-4 w-4 mr-2" /> : null}
                Save Profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Choose how you want to be notified about events and updates
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="email-notifications">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive updates via email</p>
              </div>
              <Switch
                id="email-notifications"
                checked={settings.emailNotifications}
                onCheckedChange={() => handleToggle('emailNotifications')}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="push-notifications">Push Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive push notifications on your devices</p>
              </div>
              <Switch
                id="push-notifications"
                checked={settings.pushNotifications}
                onCheckedChange={() => handleToggle('pushNotifications')}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="sms-notifications">SMS Notifications</Label>
                  {!hasSmsFeature && (
                    <Badge variant="outline" className="text-xs">Basic+</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {hasSmsFeature 
                    ? 'Receive text message alerts' 
                    : 'Upgrade to Basic or Premium to enable SMS alerts'
                  }
                </p>
                {!profile.phone && hasSmsFeature && (
                  <p className="text-xs text-amber-600">Add a phone number in Profile to receive SMS</p>
                )}
              </div>
              {!hasSmsFeature ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/subscription">Upgrade</Link>
                </Button>
              ) : (
                <Switch
                  id="sms-notifications"
                  checked={settings.smsNotifications}
                  onCheckedChange={() => handleToggle('smsNotifications')}
                  disabled={!profile.phone}
                />
              )}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="event-reminders">Event Reminders</Label>
                <p className="text-sm text-muted-foreground">Get reminded before events start</p>
              </div>
              <Switch
                id="event-reminders"
                checked={settings.eventReminders}
                onCheckedChange={() => handleToggle('eventReminders')}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="location-alerts">Location Alerts</Label>
                <p className="text-sm text-muted-foreground">Receive geofence and location alerts</p>
              </div>
              <Switch
                id="location-alerts"
                checked={settings.locationAlerts}
                onCheckedChange={() => handleToggle('locationAlerts')}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="weekly-digest">Weekly Digest</Label>
                <p className="text-sm text-muted-foreground">Receive a weekly summary email</p>
              </div>
              <Switch
                id="weekly-digest"
                checked={settings.weeklyDigest}
                onCheckedChange={() => handleToggle('weeklyDigest')}
              />
            </div>
            <Separator />
            <div className="space-y-3">
              <div>
                <Label>Default Reminder Times</Label>
                <p className="text-sm text-muted-foreground">
                  New events start with these reminders already selected. You can still change them on each event.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {DEFAULT_REMINDER_CHOICES.map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`default-reminder-${opt.value}`}
                      checked={defaultReminders.includes(opt.value)}
                      onCheckedChange={(checked) => handleToggleDefaultReminder(opt.value, checked === true)}
                      disabled={settingsLoading}
                    />
                    <label htmlFor={`default-reminder-${opt.value}`} className="text-sm cursor-pointer">
                      {opt.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Calendar & Task Sync - renamed from "Calendar Sync" since this
            section also covers the one-off .ics file/URL import, not just
            ongoing Google/Apple sync. */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Calendar &amp; Task Sync
            </CardTitle>
            <CardDescription>
              Connect Google or Apple Calendar, or import from any calendar app
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Sync with external calendars, or import a .ics file from Outlook, Android, or iOS
                </p>
              </div>
              <Button variant="outline" asChild>
                <Link href="/settings/calendar-sync">
                  Manage
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Security
            </CardTitle>
            <CardDescription>
              Manage your account security settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Password</Label>
                <p className="text-sm text-muted-foreground">Change your account password</p>
              </div>
              <ChangePasswordButton />
            </div>
            <Separator />
            <TwoFactorSettings />
          <Separator />
          <ActiveSessions />
          </CardContent>
        </Card>

        {/* Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Preferences
            </CardTitle>
            <CardDescription>
              Customize your app experience
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {mounted && resolvedTheme === 'dark' ? (
                  <Moon className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <Sun className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <Label htmlFor="dark-mode">Dark Mode</Label>
                  <p className="text-sm text-muted-foreground">Use dark theme</p>
                </div>
              </div>
              <Switch
                id="dark-mode"
                checked={mounted ? resolvedTheme === 'dark' : false}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Language</Label>
                <p className="text-sm text-muted-foreground">Select your preferred language</p>
              </div>
              <select
                value={settings.language}
                onChange={(e) => setSettings(prev => ({ ...prev, language: e.target.value }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Shield className="h-5 w-5" />
              Danger Zone
            </CardTitle>
            <CardDescription>
              Irreversible actions for your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Export Data</Label>
                <p className="text-sm text-muted-foreground">
                  Download everything Togethr stores about you: profile, families, location history, events, tasks,
                  reminders, notifications, SOS alerts, billing and account activity. Choose Excel to read it, or JSON for a complete machine-readable copy.
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" onClick={() => handleExportData('xlsx')} disabled={exporting}>
                  {exporting ? <Spinner className="w-4 h-4 mr-2" /> : <Download className="w-4 h-4 mr-2" />}
                  Excel
                </Button>
                <Button variant="outline" onClick={() => handleExportData('json')} disabled={exporting}>
                  JSON
                </Button>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-amber-600">Reset Account</Label>
                <p className="text-sm text-muted-foreground">Clear all data and start fresh (keeps your login)</p>
              </div>
              <Button variant="outline" className="text-amber-600 border-amber-600 hover:bg-amber-50" onClick={() => setShowResetDialog(true)}>
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset Account
              </Button>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-destructive">Delete Account</Label>
                <p className="text-sm text-muted-foreground">Permanently delete your account and all data</p>
              </div>
              <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Account
              </Button>
            </div>
          </CardContent>
        </Card>

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

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Spinner className="w-4 h-4 mr-2" /> : null}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
