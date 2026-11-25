'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Logo } from '@/components/brand/logo'
import { AGE_CONFIRMATION_LABEL } from '@/lib/consent-text'
import { detectBrowserTimeZone, setTokens } from '@/hooks/use-auth'
import { storedSignupSource } from '@/components/source-capture'

// Last step of "Continue with Google" for someone new: nothing is created until
// they confirm they are 18+ and accept the Terms, same as the email sign-up.
export default function RegisterWithGooglePage() {
  const [who, setWho] = useState<{ email: string; name: string } | null>(null)
  const [expired, setExpired] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/google/complete')
      .then((r) => r.json())
      .then((j) => (j?.success ? setWho(j.data) : setExpired(true)))
      .catch(() => setExpired(true))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ageConfirmed || !termsAccepted) return
    setBusy(true)
    try {
      const signupSource = storedSignupSource() ?? undefined
      const res = await fetch('/api/auth/google/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ageConfirmed, termsAccepted, timezone: detectBrowserTimeZone(), signupSource }),
      })
      const json = await res.json().catch(() => null)
      if (!json?.success) {
        toast.error(json?.error || 'Could not create your account')
        setBusy(false)
        return
      }
      setTokens(json.data.tokens.accessToken, json.data.tokens.refreshToken)
      toast.success('Account created successfully!')
      window.location.replace('/onboarding')
    } catch {
      toast.error('Could not create your account')
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <Card>
          <CardHeader>
            <CardTitle>One last step</CardTitle>
            <CardDescription>
              {who ? <>Creating your Togethr account for <strong>{who.email}</strong>.</> : 'Finishing your Google sign-in…'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expired ? (
              <p className="text-sm">
                That sign-in expired. <Link href="/login" className="text-primary underline">Go back to sign in</Link>.
              </p>
            ) : !who ? (
              <div className="flex justify-center py-4"><Spinner className="h-5 w-5" /></div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox id="age-confirmed" checked={ageConfirmed} onCheckedChange={(c) => setAgeConfirmed(c === true)} className="mt-0.5" />
                    <Label htmlFor="age-confirmed" className="text-sm font-normal leading-snug">{AGE_CONFIRMATION_LABEL}</Label>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox id="terms-accepted" checked={termsAccepted} onCheckedChange={(c) => setTermsAccepted(c === true)} className="mt-0.5" />
                    <Label htmlFor="terms-accepted" className="text-sm font-normal leading-snug">
                      I agree to the{' '}
                      <Link href="/terms" className="underline hover:text-foreground">Terms of Service</Link>
                      {' '}and{' '}
                      <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
                    </Label>
                  </div>
                </div>
                <Button type="submit" className="w-full h-11" disabled={busy || !ageConfirmed || !termsAccepted}>
                  {busy ? <Spinner className="w-4 h-4" /> : 'Create account'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
