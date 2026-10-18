'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { LogoIcon } from '@/components/logo'
import { SignedInRedirect } from '@/components/signed-in-redirect'

export default function LoginPage() {
  const router = useRouter()
  const { login, verifyTwoFactor } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  // Set once the password step succeeds but the account has 2FA enabled;
  // presence of a challenge token is what switches the form to the code step.
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const getRedirectTarget = () => {
    try {
      const r = new URLSearchParams(window.location.search).get('redirect')
      if (r && r.startsWith('/') && !r.startsWith('//') && !r.startsWith('/\\') && !r.startsWith('/login')) return r
    } catch {}
    return '/dashboard'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    const result = await login(formData.email, formData.password)

    if (result.success && result.requiresTwoFactor && result.challengeToken) {
      setChallengeToken(result.challengeToken)
    } else if (result.success) {
      toast.success('Welcome back!')
      // Navigate to dashboard - auth state is stored in localStorage
      router.push(getRedirectTarget())
    } else {
      toast.error(result.error || 'Login failed')
    }

    setIsLoading(false)
  }

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!challengeToken) return
    setIsLoading(true)

    const result = await verifyTwoFactor(challengeToken, twoFactorCode.trim())

    if (result.success) {
      toast.success('Welcome back!')
      router.push(getRedirectTarget())
    } else {
      toast.error(result.error || 'Invalid code')
    }

    setIsLoading(false)
  }

  if (challengeToken) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center gap-3 mb-8">
            <LogoIcon size="lg" />
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">Togethr</h1>
              <p className="text-sm text-muted-foreground">Family coordination made simple</p>
            </div>
          </div>

          <Card className="border-border/50 shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Two-factor authentication</CardTitle>
              <CardDescription>Enter the 6-digit code from your authenticator app, or a backup code</CardDescription>
            </CardHeader>
            <form onSubmit={handleTwoFactorSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="twoFactorCode">Code</Label>
                  <Input
                    id="twoFactorCode"
                    type="text"
                    inputMode="numeric"
                    placeholder="123456"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value)}
                    required
                    autoComplete="one-time-code"
                    autoFocus
                    className="h-11 text-center text-lg tracking-widest"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full h-11" disabled={isLoading}>
                  {isLoading ? <Spinner className="w-4 h-4" /> : 'Verify'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setChallengeToken(null); setTwoFactorCode('') }}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                >
                  Back to sign in
                </button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <SignedInRedirect to={getRedirectTarget} />
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <LogoIcon size="lg" />
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Togethr</h1>
            <p className="text-sm text-muted-foreground">Family coordination made simple</p>
          </div>
        </div>

        <Card className="border-border/50 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your account to continue</CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                  autoComplete="email"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link 
                    href="/forgot-password" 
                    className="text-sm text-primary hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    autoComplete="current-password"
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-4">
              <Button type="submit" className="w-full h-11" disabled={isLoading}>
                {isLoading ? <Spinner className="w-4 h-4" /> : 'Sign in'}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                {"Don't have an account? "}
                <Link href="/register" className="text-primary font-medium hover:underline">
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By signing in, you agree to our{' '}
          <Link href="/terms" className="underline hover:text-foreground">Terms of Service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
