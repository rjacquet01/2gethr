'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useFamilies } from '@/hooks/use-family'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Users, UserPlus, ArrowRight } from 'lucide-react'
import { LogoIcon } from '@/components/logo'

type OnboardingStep = 'welcome' | 'create' | 'join'

export default function OnboardingPage() {
  const router = useRouter()
  const { createFamily, joinFamily } = useFamilies()
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [isLoading, setIsLoading] = useState(false)
  const [familyName, setFamilyName] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  // An invite link looks like /onboarding?code=ABCD1234. Jump straight to the
  // "join" step with the code filled in. The code is also remembered in
  // localStorage so it survives the sign-up / sign-in detour for someone who
  // opens the link before they have an account.
  useEffect(() => {
    try {
      const fromLink = new URLSearchParams(window.location.search).get('code')
      const code = (fromLink || localStorage.getItem('togethr-pending-invite') || '')
        .trim()
        .toUpperCase()
        .slice(0, 8)
      if (code) {
        if (fromLink) localStorage.setItem('togethr-pending-invite', code)
        setInviteCode(code)
        setStep('join')
      }
    } catch {
      // storage unavailable - fall back to manual entry
    }
  }, [])

  const handleCreateFamily = async () => {
    if (!familyName.trim()) {
      toast.error('Please enter a family name')
      return
    }

    setIsLoading(true)
    const result = await createFamily(familyName)

    if (result.success) {
      toast.success('Family created successfully!')
      router.push('/dashboard')
    } else {
      toast.error(result.error || 'Failed to create family')
    }

    setIsLoading(false)
  }

  const handleJoinFamily = async () => {
    if (!inviteCode.trim()) {
      toast.error('Please enter an invite code')
      return
    }

    setIsLoading(true)
    const result = await joinFamily(inviteCode)

    if (result.success) {
      try { localStorage.removeItem('togethr-pending-invite') } catch {}
      toast.success('Joined family successfully!')
      router.push('/dashboard')
    } else if (/unauthor|authenticat|token/i.test(result.error || '')) {
      // Opened an invite link without being signed in. The code stays saved
      // on this device, so sign up / sign in and it will be waiting here.
      toast.info('Create an account or sign in first - your invite code will be waiting.')
      router.push('/register')
    } else {
      toast.error(result.error || 'Failed to join family')
    }

    setIsLoading(false)
  }

  if (step === 'welcome') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 mb-8">
            <LogoIcon size="xl" />
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">Welcome to Togethr</h1>
              <p className="text-sm text-muted-foreground">
                {"Let's get your family set up"}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <Card 
              className="cursor-pointer border-border/50 hover:border-primary/50 transition-colors"
              onClick={() => setStep('create')}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
                  <Users className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">Create a Family</h3>
                  <p className="text-sm text-muted-foreground">Start fresh and invite your family members</p>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer border-border/50 hover:border-primary/50 transition-colors"
              onClick={() => setStep('join')}
            >
              <CardContent className="flex items-center gap-4 p-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-accent/20 text-accent-foreground">
                  <UserPlus className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">Join a Family</h3>
                  <p className="text-sm text-muted-foreground">Use an invite code from a family member</p>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>

          <Button 
            variant="ghost" 
            className="w-full mt-6" 
            onClick={() => router.push('/dashboard')}
          >
            {"I'll do this later"}
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'create') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md">
          <Card className="border-border/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary">
                  <Users className="w-5 h-5" />
                </div>
                Create Your Family
              </CardTitle>
              <CardDescription>
                Give your family a name. You can change this later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="familyName">Family Name</Label>
                <Input
                  id="familyName"
                  type="text"
                  placeholder="e.g., The Smiths"
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  className="h-11"
                  autoFocus
                />
              </div>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('welcome')} className="flex-1">
                Back
              </Button>
              <Button onClick={handleCreateFamily} disabled={isLoading} className="flex-1">
                {isLoading ? <Spinner className="w-4 h-4" /> : 'Create Family'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'join') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md">
          <Card className="border-border/50 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent/20 text-accent-foreground">
                  <UserPlus className="w-5 h-5" />
                </div>
                Join a Family
              </CardTitle>
              <CardDescription>
                Enter the invite code shared by a family member.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inviteCode">Invite Code</Label>
                <Input
                  id="inviteCode"
                  type="text"
                  placeholder="Enter 8-character code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  className="h-11 font-mono text-center tracking-wider"
                  maxLength={8}
                  autoFocus
                />
              </div>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button variant="outline" onClick={() => setStep('welcome')} className="flex-1">
                Back
              </Button>
              <Button onClick={handleJoinFamily} disabled={isLoading} className="flex-1">
                {isLoading ? <Spinner className="w-4 h-4" /> : 'Join Family'}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    )
  }

  return null
}
