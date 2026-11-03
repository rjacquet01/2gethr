import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'
import { IphoneSetupSteps } from '@/components/iphone-setup'

export const metadata = {
  title: 'Togethr on iPhone | Togethr',
  description: 'Add Togethr to your iPhone Home Screen to get notifications: open in Safari, Add to Home Screen, turn on notifications.',
}

export default function IphonePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <Logo height={36} priority />
          </Link>
          <Button variant="ghost" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <h1 className="text-3xl font-bold mb-2">Togethr on iPhone</h1>
        <p className="text-muted-foreground mb-8">
          Togethr works in Safari on iPhone and iPad, with no App Store download. Add it to your Home Screen
          and it opens like an app, with notifications for reminders, arrivals and alerts.
        </p>
        <IphoneSetupSteps />
      </main>
    </div>
  )
}
