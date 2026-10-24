import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'

export const metadata = {
  title: 'Delete Your Account | Togethr',
  description: 'How to delete your Togethr account and personal data',
}

export default function DeleteAccountPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <Logo height={36} priority />
          </Link>
          <Button variant="ghost" asChild>
            <Link href="/login">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-8">Delete Your Togethr Account</h1>

        <div className="space-y-8">
          <p className="text-muted-foreground">
            You can delete your Togethr account and the personal data tied to it at any time.
          </p>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Delete it yourself (fastest)</h2>
            <ol className="list-decimal pl-6 space-y-2">
              <li>Sign in to Togethr on the web (mytogethr.com) or in the app.</li>
              <li>Open <strong>Settings</strong>.</li>
              <li>Choose <strong>Delete Account</strong>, then type your account email to confirm.</li>
            </ol>
            <p>
              Your account is closed immediately: you are signed out everywhere, your profile
              details, saved location history and device connections are removed, and the account can
              no longer be used to sign in.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Can&apos;t sign in?</h2>
            <p>
              Email{' '}
              <a href="mailto:admin@mytogethr.com?subject=Account%20deletion%20request" className="text-primary hover:underline">
                admin@mytogethr.com
              </a>{' '}
              from the email address on the account with the subject &quot;Account deletion
              request&quot;. We will verify it is you and delete the account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What is deleted</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Your name, email, phone number and profile photo</li>
              <li>Your location history and location sharing settings</li>
              <li>Your sign-in sessions, device tokens and notification settings</li>
            </ul>
            <p>
              Events, tasks and other shared items that belong to your family may remain visible to
              the rest of the family, without your personal details. Family organizers can also
              remove a child&apos;s data from the family at any time. See our{' '}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>{' '}
              for how long limited records are kept for legal or compliance reasons.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
