'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFamilies, useFamily } from '@/hooks/use-family'
import { useAuth, authFetch } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { 
  Settings, Users, Shield, Bell, Copy, RefreshCw, 
  AlertTriangle, ArrowLeft, Home, Mail, MessageSquare, Share2
} from 'lucide-react'
import Link from 'next/link'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function FamilySettingsPage() {
  const router = useRouter()
  const { user } = useAuth()
  // The selected family is shared with the sidebar family switcher, so
  // switching there (or on this page) changes it everywhere.
  const { families, selectedFamilyId, selectFamily, isLoading: familiesLoading } = useFamilies()
  
  const { family, isLoading: familyLoading, mutate } = useFamily(selectedFamilyId || undefined)
  
  const [saving, setSaving] = useState(false)
  const [regeneratingCode, setRegeneratingCode] = useState(false)
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    requiresEventApproval: false,
    allowChildLocation: true,
  })

  // Update form when family data loads
  useEffect(() => {
    if (family) {
      setFormData({
        name: family.name || '',
        description: '',
        requiresEventApproval: false,
        allowChildLocation: true,
      })
    }
  }, [family])

  // Ownership is tracked on the family itself (owner_id), not as a member role
  // (member roles are PARENT / CHILD / GUARDIAN).
  const isOwner = !!family && !!user && family.ownerId === user.id

  const handleSave = async () => {
    if (!selectedFamilyId) return
    
    setSaving(true)
    try {
      const res = await authFetch(`/api/families/${selectedFamilyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
        }),
      })

      if (res.ok) {
        toast.success('Family settings saved')
        mutate()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const regenerateInviteCode = async () => {
    if (!selectedFamilyId) return
    
    setRegeneratingCode(true)
    try {
      const res = await authFetch(`/api/families/${selectedFamilyId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate' }),
      })

      if (res.ok) {
        toast.success('Invite code regenerated')
        mutate()
      } else {
        toast.error('Failed to regenerate invite code')
      }
    } catch {
      toast.error('Failed to regenerate invite code')
    } finally {
      setRegeneratingCode(false)
    }
  }

  const copyInviteCode = () => {
    if (family?.inviteCode) {
      navigator.clipboard.writeText(family.inviteCode)
      toast.success('Invite code copied to clipboard')
    }
  }

  const getInviteMessage = () => {
    const code = family?.inviteCode
    const familyName = family?.name || 'our family'
    return `Join ${familyName} on Togethr! Use invite code: ${code}\n\nDownload the app and enter this code to connect with our family.`
  }

  const handleShareEmail = () => {
    const subject = encodeURIComponent(`Join ${family?.name || 'our family'} on Togethr`)
    const body = encodeURIComponent(getInviteMessage())
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank')
  }

  const handleShareSMS = () => {
    const message = encodeURIComponent(getInviteMessage())
    window.open(`sms:?body=${message}`, '_blank')
  }

  const handleShareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${family?.name || 'our family'} on Togethr`,
          text: getInviteMessage(),
        })
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          toast.error('Failed to share')
        }
      }
    } else {
      copyInviteCode()
    }
  }

  if (familiesLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (families.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/family">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Family Settings</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Home className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No Family Found</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mt-1">
              You need to create or join a family first before managing settings.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/family">Go to Family</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/family">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Family Settings</h1>
          <p className="text-muted-foreground">Manage your family configuration</p>
        </div>
      </div>

      {families.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {families.map((f) => (
            <Button
              key={f.id}
              variant={selectedFamilyId === f.id ? 'default' : 'outline'}
              size="sm"
              onClick={() => selectFamily(f.id)}
            >
              {f.name}
            </Button>
          ))}
        </div>
      )}

      {familyLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <div className="grid gap-6">
          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                General Settings
              </CardTitle>
              <CardDescription>
                Basic information about your family
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Family Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter family name"
                  disabled={!isOwner}
                />
              </div>
              {!isOwner && (
                <p className="text-sm text-muted-foreground">
                  Only the family owner can change these settings.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Invite Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Invite Members
              </CardTitle>
              <CardDescription>
                Share this code to invite new members to your family
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-lg tracking-wider">
                  {family?.inviteCode || 'No code generated'}
                </div>
                <Button variant="outline" size="icon" onClick={copyInviteCode} title="Copy code">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              {family?.inviteCode && (
                <div className="flex flex-wrap items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="default">
                        <Share2 className="h-4 w-4 mr-2" />
                        Share Invite
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={handleShareEmail}>
                        <Mail className="h-4 w-4 mr-2" />
                        Share via Email
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareSMS}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Share via Text
                      </DropdownMenuItem>
                      {typeof navigator !== 'undefined' && navigator.share && (
                        <DropdownMenuItem onClick={handleShareNative}>
                          <Share2 className="h-4 w-4 mr-2" />
                          More Options...
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {isOwner && (
                    <Button
                      variant="outline"
                      onClick={regenerateInviteCode}
                      disabled={regeneratingCode}
                    >
                      {regeneratingCode ? (
                        <Spinner className="h-4 w-4 mr-2" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      New Code
                    </Button>
                  )}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                Anyone with this code can request to join your family.
              </p>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          {isOwner && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                  Danger Zone
                </CardTitle>
                <CardDescription>
                  Irreversible actions for your family
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-destructive">Delete Family</Label>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete this family and all associated data
                    </p>
                  </div>
                  <Button variant="destructive">Delete Family</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isOwner && (
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Spinner className="w-4 h-4 mr-2" /> : null}
                Save Changes
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
