import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'

export const metadata = {
  title: 'Privacy Policy | Togethr',
  description: 'Privacy Policy for Togethr, the family coordination app operated by Togethr, LLC',
}

const CONTACT = 'admin@mytogethr.com'

function Contact() {
  return (
    <a href={`mailto:${CONTACT}`} className="text-primary hover:underline">
      {CONTACT}
    </a>
  )
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
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
        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>

        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">Last updated: October 16, 2026</p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Who we are</h2>
            <p>
              Togethr is operated by Togethr, LLC ("Togethr", "we", "our", or "us"). This Privacy Policy
              explains what personal information we collect through the Togethr website, web app and
              mobile apps (the "Service"), how we use it, who we share it with, and the choices you have.
              Togethr, LLC is the company responsible for your information.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Information we collect</h2>

            <h3 className="text-lg font-medium">Information you give us</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Name, email address and password (stored only as a salted hash)</li>
              <li>Optional phone number and profile photo</li>
              <li>Family, member and child profiles, including a child's name, date of birth, school, grade and emergency notes that a parent chooses to enter</li>
              <li>Calendar events, tasks, reminders, saved places, and notes</li>
              <li>Messages you post in the Service: event comments, family board posts and replies, and support tickets</li>
            </ul>

            <h3 className="text-lg font-medium">Information collected as you use the Service</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Location, only if you or a parent turn on location sharing, and only while sharing is enabled</li>
              <li>Device and app information such as browser, operating system, push notification token and IP address</li>
              <li>Basic usage and performance analytics</li>
              <li>Security and audit logs of account actions</li>
            </ul>

            <h3 className="text-lg font-medium">Information from services you connect</h3>
            <p>
              If you choose to sync an external calendar (for example Google Calendar or Apple iCloud),
              we receive the events and tasks you authorize and send back the ones you choose to sync.
              You can disconnect at any time in Settings, which stops syncing.
            </p>

            <h3 className="text-lg font-medium">Payment information</h3>
            <p>
              Payments are processed by Stripe. Your card details go directly to Stripe and are never
              stored on our servers. We keep only your subscription plan, status, and Stripe customer and
              subscription identifiers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. How we use information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide the Service and enable family coordination features</li>
              <li>Send reminders, alerts, safety notifications and service emails</li>
              <li>Process subscriptions and prevent fraud</li>
              <li>Respond to support requests</li>
              <li>Keep the Service secure, debug problems and improve it</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p>We do not sell your personal information and we do not use it for third-party advertising.</p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Location data</h2>
            <p>
              Location sharing is off by default. When it is on, your location is visible only to family
              members who are permitted to see it. People who join a family as a limited-access guest
              cannot see location or saved places. Location history is kept according to your plan's
              retention limit, and is deleted when you turn sharing off, delete your account, or the
              retention period ends. You can turn location sharing off at any time.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Who we share information with</h2>
            <p>We share information only as follows:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Your family.</strong> Calendar, task, board and (if enabled) location information is
                visible to other members of your family according to their role.
              </li>
              <li>
                <strong>Service providers</strong> that process data on our behalf:
                <ul className="list-disc pl-6 space-y-1 mt-1">
                  <li>Vercel: application hosting, analytics and file storage</li>
                  <li>Neon: database hosting</li>
                  <li>Stripe: payment processing and billing</li>
                  <li>Resend: transactional and notification email</li>
                  <li>Google Firebase Cloud Messaging: push notifications</li>
                  <li>OpenStreetMap-based services: map tiles and address lookup (the address or coordinates you look up may be sent to them)</li>
                  <li>Calendar providers you connect (Google, Apple)</li>
                </ul>
              </li>
              <li>
                <strong>Legal and safety.</strong> When required by law or valid legal process, or to
                protect the rights, safety or property of users or the public.
              </li>
              <li>
                <strong>Business transfers.</strong> If Togethr, LLC is involved in a merger, acquisition or
                sale of assets, information may be transferred, and we will tell you if your information
                becomes subject to a different privacy policy.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Children's privacy</h2>
            <p>
              The Service is designed for families and is not directed to children to use on their own.
              Only a parent or legal guardian can create a child profile or a child account. A parent can
              create an account for a child aged 8 or older, and by doing so confirms that they are the
              child's parent or legal guardian and consent to the collection and use of the child's
              information as described here, including for a child under 13. We record that consent.
            </p>
            <p>
              We collect only what is needed to run the Service for the child (such as name, date of
              birth, and the calendar, tasks and messages the family creates). We do not use children's
              information for advertising and do not sell it. A child's location is off by default and is
              enabled only by the parent. Child accounts have restricted permissions. A parent can review,
              correct, export or delete their child's information, or withdraw consent, at any time in the
              app or by contacting <Contact />. If we learn we collected information from a child under 13
              without parental consent, we will delete it.
            </p>
            <p>
              When a child turns 18, they become an adult member with their own controls, and location
              sharing is reset to off until they choose otherwise.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Security</h2>
            <p>
              We use industry-standard safeguards, including encryption in transit, encrypted database
              storage, hashed passwords, role-based access controls, rate limiting and audit logging. No
              system is perfectly secure, so we cannot guarantee absolute security. Please use a strong,
              unique password.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Your choices and rights</h2>
            <p>You can:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access and update your information in the app</li>
              <li>Export your data from Settings</li>
              <li>Delete your account from Settings</li>
              <li>Turn location sharing and notifications on or off</li>
              <li>Opt out of non-essential email</li>
            </ul>
            <p>
              Depending on where you live (for example California, other U.S. states, or the EU/UK), you
              may also have the right to request access, correction, deletion or portability of your
              personal information, to object to or restrict certain processing, and to not be
              discriminated against for exercising these rights. To make a request, email <Contact />.
              We may need to verify your identity first. We do not sell or share personal information for
              cross-context behavioral advertising.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Data retention</h2>
            <p>
              We keep your information while your account is active. After you delete your account, we
              keep it for up to 30 days for recovery and then delete it, except where we must keep
              limited records longer for legal, tax, fraud-prevention or dispute purposes (for example,
              payment records held by Stripe). Board posts and comments are removed under the retention
              limits shown in the app and when deleted by you or a family adult.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. International users</h2>
            <p>
              Togethr, LLC is based in the United States and our providers may process data in the United
              States and other countries. By using the Service you understand that your information may
              be transferred to and processed in these locations.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy. When we make significant changes we will notify you by
              email or in the Service and update the date above.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12. Contact us</h2>
            <p>
              Togethr, LLC
              <br />
              29 Prospect Rd, Andover, MA 01810
              <br />
              Questions or requests about this policy or your data: <Contact />
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
