'use client'

import { useEffect, useState } from 'react'
import {
  Bell,
  Mail,
  MessageSquare,
  Smartphone,
  Phone,
  Settings,
  TestTube,
  Check,
  X,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { toast } from 'sonner'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'

interface ServiceStatus {
  configured: boolean
  lastTested?: string
  lastTestResult?: 'success' | 'failed'
}

interface NotificationServices {
  sms: ServiceStatus
  email: ServiceStatus
  push: ServiceStatus
}

export default function AdminNotificationsPage() {
  const [services, setServices] = useState<NotificationServices | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)

  // Twilio (SMS) config
  const [twilioAccountSid, setTwilioAccountSid] = useState('')
  const [twilioAuthToken, setTwilioAuthToken] = useState('')
  const [twilioPhoneNumber, setTwilioPhoneNumber] = useState('')
  const [showTwilioToken, setShowTwilioToken] = useState(false)

  // Resend (Email) config
  const [resendApiKey, setResendApiKey] = useState('')
  const [resendFromEmail, setResendFromEmail] = useState('')
  const [resendFromName, setResendFromName] = useState('Togethr')
  const [showResendKey, setShowResendKey] = useState(false)

  // Web Push (VAPID) config. Despite the variable names below (kept to
  // avoid a bigger diff), this app does NOT use Firebase Cloud Messaging -
  // see lib/services/push.ts. Push is sent via the standard Web Push
  // protocol, configured with a VAPID key pair, not a Firebase service
  // account.
  const [vapidPublicKey, setVapidPublicKey] = useState('')
  const [vapidPrivateKey, setVapidPrivateKey] = useState('')
  const [showVapidKey, setShowVapidKey] = useState(false)

  // Test message state
  const [testPhone, setTestPhone] = useState('')
  const [testEmail, setTestEmail] = useState('')
  const [sendingTargetedPush, setSendingTargetedPush] = useState(false)
  const [targetedPushResults, setTargetedPushResults] = useState<{email: string, status: string, error?: string}[] | null>(null)

  useEffect(() => {
    fetchServiceStatus()
  }, [])

  const fetchServiceStatus = async () => {
    try {
      const token = getAdminAccessToken()
      const res = await fetch('/api/admin/notifications/config-status', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setServices(data)
      }
    } catch (error) {
      console.error('Failed to fetch service status:', error)
    } finally {
      setLoading(false)
    }
  }

  const testService = async (service: 'sms' | 'email' | 'push') => {
    setTesting(service)
    try {
      const token = getAdminAccessToken()
      const body: Record<string, string> = { service }

      if (service === 'sms' && testPhone) {
        body.phone = testPhone
      } else if (service === 'email' && testEmail) {
        body.email = testEmail
      }

      const res = await fetch('/api/admin/notifications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      })

      const data = await res.json()

      if (res.ok && data.success) {
        toast.success(`${service.toUpperCase()} test successful!`)
        fetchServiceStatus()
      } else {
        toast.error(data.error || `${service.toUpperCase()} test failed`)
      }
    } catch (error) {
      toast.error(`Failed to test ${service}`)
    } finally {
      setTesting(null)
    }
  }

  const saveConfig = async (service: 'twilio' | 'resend' | 'vapid') => {
    try {
      const token = getAdminAccessToken()
      let config: Record<string, string> = {}

      switch (service) {
        case 'twilio':
          config = {
            accountSid: twilioAccountSid,
            authToken: twilioAuthToken,
            phoneNumber: twilioPhoneNumber
          }
          break
        case 'resend':
          config = {
            apiKey: resendApiKey,
            fromEmail: resendFromEmail,
            fromName: resendFromName
          }
          break
        case 'vapid':
          config = {
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey
          }
          break
      }

      const res = await fetch('/api/admin/notifications/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ service, config })
      })

      if (res.ok) {
        toast.success(`${service} configuration saved`)
        fetchServiceStatus()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save configuration')
      }
    } catch (error) {
      toast.error('Failed to save configuration')
    }
  }

  const ServiceStatusBadge = ({ status }: { status: ServiceStatus }) => {
    if (!status.configured) {
      return <Badge variant="outline" className="text-muted-foreground">Not Configured</Badge>
    }
    if (status.lastTestResult === 'success') {
      return <Badge className="bg-green-500">Active</Badge>
    }
    if (status.lastTestResult === 'failed') {
      return <Badge variant="destructive">Failed</Badge>
    }
    return <Badge variant="secondary">Configured</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notification Services</h1>
          <p className="text-muted-foreground">Configure SMS, email, and push notification providers</p>
        </div>
        <Button variant="outline" onClick={fetchServiceStatus}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh Status
        </Button>
      </div>

      {/* Service Overview Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SMS (Twilio)</CardTitle>
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <ServiceStatusBadge status={services?.sms || { configured: false }} />
            <p className="text-xs text-muted-foreground mt-2">
              {services?.sms?.lastTested
                ? `Last tested: ${new Date(services.sms.lastTested).toLocaleString()}`
                : 'Never tested'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Email (Resend)</CardTitle>
            <Mail className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <ServiceStatusBadge status={services?.email || { configured: false }} />
            <p className="text-xs text-muted-foreground mt-2">
              {services?.email?.lastTested
                ? `Last tested: ${new Date(services.email.lastTested).toLocaleString()}`
                : 'Never tested'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Push (Web Push)</CardTitle>
            <Smartphone className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <ServiceStatusBadge status={services?.push || { configured: false }} />
            <p className="text-xs text-muted-foreground mt-2">
              {services?.push?.lastTested
                ? `Last tested: ${new Date(services.push.lastTested).toLocaleString()}`
                : 'Never tested'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Configuration Tabs */}
      <Tabs defaultValue="sms" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sms">
            <MessageSquare className="w-4 h-4 mr-2" />
            SMS (Twilio)
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="w-4 h-4 mr-2" />
            Email (Resend)
          </TabsTrigger>
          <TabsTrigger value="push">
            <Bell className="w-4 h-4 mr-2" />
            Push (Web Push)
          </TabsTrigger>
        </TabsList>

        {/* SMS Configuration */}
        <TabsContent value="sms">
          <Card>
            <CardHeader>
              <CardTitle>Twilio SMS Configuration</CardTitle>
              <CardDescription>
                Configure Twilio for sending SMS alerts and notifications.
                <a
                  href="https://console.twilio.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-primary inline-flex items-center hover:underline"
                >
                  Open Twilio Console <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertTitle>Environment Variables Required</AlertTitle>
                <AlertDescription>
                  Add these to your Vercel project settings: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="twilioSid">Account SID</Label>
                  <Input
                    id="twilioSid"
                    name="twilioSid"
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={twilioAccountSid}
                    onChange={(e) => setTwilioAccountSid(e.target.value)}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilioToken">Auth Token</Label>
                  <div className="relative">
                    <Input
                      id="twilioToken"
                      name="twilioToken"
                      type={showTwilioToken ? 'text' : 'password'}
                      placeholder="Your auth token"
                      value={twilioAuthToken}
                      onChange={(e) => setTwilioAuthToken(e.target.value)}
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowTwilioToken(!showTwilioToken)}
                    >
                      {showTwilioToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="twilioPhone">Phone Number</Label>
                  <Input
                    id="twilioPhone"
                    name="twilioPhone"
                    placeholder="+1234567890"
                    value={twilioPhoneNumber}
                    onChange={(e) => setTwilioPhoneNumber(e.target.value)}
                    autoComplete="off"
                    data-1p-ignore
                    data-lpignore="true"
                  />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Test SMS</h4>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter phone number to test"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => testService('sms')}
                    disabled={testing === 'sms' || !testPhone}
                  >
                    {testing === 'sms' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4 mr-2" />
                    )}
                    Send Test SMS
                  </Button>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => saveConfig('twilio')}>
                  Save Twilio Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Configuration */}
        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Resend Email Configuration</CardTitle>
              <CardDescription>
                Configure Resend for sending email notifications.
                <a
                  href="https://resend.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-primary inline-flex items-center hover:underline"
                >
                  Get API Key <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {services?.email?.configured ? (
                <Alert className="border-green-200 bg-green-50">
                  <Check className="w-4 h-4 text-green-600" />
                  <AlertTitle className="text-green-800">Email Configured</AlertTitle>
                  <AlertDescription className="text-green-700">
                    Resend API key is configured and your domain (mytogethr.com) is verified.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>Environment Variable Required</AlertTitle>
                  <AlertDescription>
                    Add RESEND_API_KEY to your Vercel project settings. You&apos;ll also need to verify your sending domain.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="resendKey">API Key</Label>
                  <div className="relative">
                    <Input
                      id="resendKey"
                      type={showResendKey ? 'text' : 'password'}
                      placeholder="re_xxxxxxxxxxxx"
                      value={resendApiKey}
                      onChange={(e) => setResendApiKey(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowResendKey(!showResendKey)}
                    >
                      {showResendKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resendFrom">From Email</Label>
                  <Input
                    id="resendFrom"
                    type="email"
                    placeholder="notifications@yourdomain.com"
                    value={resendFromEmail}
                    onChange={(e) => setResendFromEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="resendName">From Name</Label>
                  <Input
                    id="resendName"
                    placeholder="Togethr"
                    value={resendFromName}
                    onChange={(e) => setResendFromName(e.target.value)}
                  />
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Test Email</h4>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Enter email to test"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => testService('email')}
                    disabled={testing === 'email' || !testEmail}
                  >
                    {testing === 'email' ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4 mr-2" />
                    )}
                    Send Test Email
                  </Button>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => saveConfig('resend')}>
                  Save Resend Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Push Configuration */}
        <TabsContent value="push">
          <Card>
            <CardHeader>
              <CardTitle>Web Push (VAPID) Configuration</CardTitle>
              <CardDescription>
                Push notifications (browser and the installed Android app alike) are sent with the
                standard Web Push protocol, authenticated with a VAPID key pair. This app does not
                use Firebase Cloud Messaging.
                <a
                  href="https://developer.mozilla.org/en-US/docs/Web/API/Push_API"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-primary inline-flex items-center hover:underline"
                >
                  About Web Push / VAPID <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {services?.push?.configured ? (
                <Alert className="border-green-200 bg-green-50">
                  <Check className="w-4 h-4 text-green-600" />
                  <AlertTitle className="text-green-800">Web Push Configured</AlertTitle>
                  <AlertDescription className="text-green-700">
                    VAPID keys are set and push notifications are ready to send.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>Environment Variables Required</AlertTitle>
                  <AlertDescription>
                    Add NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to your Vercel project
                    settings (Production environment). Generate a pair with the
                    generateVAPIDKeys() helper in lib/services/web-push-vapid.ts, or the fields
                    below as a scratch pad - this form does not save them for you, it only
                    validates the values you paste in. The real values must be set as Vercel
                    environment variables.
                  </AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="vapidPublicKey">Public Key (NEXT_PUBLIC_VAPID_PUBLIC_KEY)</Label>
                  <Input
                    id="vapidPublicKey"
                    placeholder="base64url-encoded public key"
                    value={vapidPublicKey}
                    onChange={(e) => setVapidPublicKey(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="vapidPrivateKey">Private Key (VAPID_PRIVATE_KEY)</Label>
                  <div className="relative">
                    <Textarea
                      id="vapidPrivateKey"
                      placeholder="base64url-encoded private key"
                      value={vapidPrivateKey}
                      onChange={(e) => setVapidPrivateKey(e.target.value)}
                      className={showVapidKey ? '' : 'text-security-disc'}
                      rows={2}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2"
                      onClick={() => setShowVapidKey(!showVapidKey)}
                    >
                      {showVapidKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="border-t pt-4 mt-4">
                <h4 className="font-medium mb-2">Test Push Notification</h4>
                <p className="text-sm text-muted-foreground mb-2">
                  Send test push notifications to specific user accounts.
                </p>
                <div className="space-y-4">
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => testService('push')}
                      disabled={testing === 'push'}
                    >
                      {testing === 'push' ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <TestTube className="w-4 h-4 mr-2" />
                      )}
                      Send to All Devices
                    </Button>

                    <Button
                      variant="default"
                      onClick={async () => {
                        setSendingTargetedPush(true)
                        setTargetedPushResults(null)
                        try {
                          const token = getAdminAccessToken()
                          const res = await fetch('/api/test-push', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              Authorization: `Bearer ${token}`
                            },
                            body: JSON.stringify({
            emails: ['ray.jacquet@yahoo.com', 'maximjacquet11@gmail.com', 'info@nexuscmm.com'] })
                          })
                          const data = await res.json()
                          if (data.success) {
                            setTargetedPushResults(data.results)
                            toast.success(`Push notifications sent to ${data.results.length} device(s)`)
                          } else {
                            toast.error(data.error || 'Failed to send push notifications')
                          }
                        } catch (error) {
                          toast.error('Failed to send push notifications')
                          console.error(error)
                        } finally {
                          setSendingTargetedPush(false)
                        }
                      }}
                      disabled={sendingTargetedPush}
                    >
                      {sendingTargetedPush ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Smartphone className="w-4 h-4 mr-2" />
                      )}
                      Send to Ray & Max
                    </Button>
                  </div>

                  {targetedPushResults && (
                    <div className="bg-muted p-3 rounded-lg text-sm">
                      <p className="font-medium mb-2">Results:</p>
                      <ul className="space-y-1">
                        {targetedPushResults.map((result, i) => (
                          <li key={i} className="flex items-center gap-2">
                            {result.status === 'sent' ? (
                              <Check className="w-4 h-4 text-green-500" />
                            ) : (
                              <X className="w-4 h-4 text-red-500" />
                            )}
                            <span>{result.email}: {result.status}</span>
                            {result.error && <span className="text-red-500">({result.error})</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => saveConfig('vapid')}>
                  Validate VAPID Configuration
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Usage Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Usage</CardTitle>
          <CardDescription>Monitor notification delivery across all channels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="text-center p-4 border rounded-lg">
              <p className="text-3xl font-bold text-primary">-</p>
              <p className="text-sm text-muted-foreground">SMS Sent (This Month)</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <p className="text-3xl font-bold text-blue-500">-</p>
              <p className="text-sm text-muted-foreground">Emails Sent (This Month)</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <p className="text-3xl font-bold text-green-500">-</p>
              <p className="text-sm text-muted-foreground">Push Notifications</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <p className="text-3xl font-bold text-red-500">-</p>
              <p className="text-sm text-muted-foreground">Failed Deliveries</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
