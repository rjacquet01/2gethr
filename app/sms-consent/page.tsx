import Link from 'next/link'
import { ArrowLeft, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'
import { SmsConsentText } from '@/components/sms-consent-text'
import { SMS_HELP_REPLY } from '@/lib/sms-consent-text'
import { formatSmsBody } from '@/lib/sms-consent'
import { SMS_TEMPLATES } from '@/lib/services/sms'

export const metadata = {
  title: 'Text Message Consent | Togethr',
  description: 'How Togethr Notifications text messages work: opting in, sample messages, and STOP / HELP.',
}

const CONTACT = 'admin@mytogethr.com'

// The same templates the app sends (lib/services/sms.ts, the reminder crons, lib/sos.ts).
const SAMPLES = [
  SMS_TEMPLATES.GEOFENCE_ARRIVAL('Maya', 'School'),
  formatSmsBody('Togethr: Reminder - "Soccer practice" starts in 30 minutes at Lincoln Field.'),
  formatSmsBody('Togethr: Reminder - Take out the recycling'),
  formatSmsBody('Togethr: New Task Assigned - Sam assigned you a task: "Feed the pet"'),
  formatSmsBody('Togethr: SOS! Alex needs help. Map (live GPS): https://maps.google.com/?q=42.36,-71.06 Call them now.', { keepWhole: true }),
]

export default function SmsConsentPage() {
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

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Text messages (SMS)</h1>
        <p className="text-muted-foreground mb-8">
          Togethr Notifications, operated by Togethr, LLC. Texts are optional and off until you turn them on.
        </p>

        <div className="space-y-10">
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">How you opt in</h2>
            <p>
              A signed-in adult adds a mobile number in Settings &gt; Profile and turns on text messages. This
              is the switch and the wording they see (the same wording is next to the optional checkbox when
              creating an account). The switch is off by default.
            </p>
            <figure aria-label="The opt-in screen" className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Phone</span>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  +1 (555) 123-4567
                </div>
              </div>
              <div className="mt-3 space-y-1.5 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">Text messages</span>
                  <span
                    aria-hidden="true"
                    className="inline-flex h-5 w-9 items-center rounded-full bg-input p-0.5"
                  >
                    <span className="h-4 w-4 rounded-full bg-background shadow" />
                  </span>
                </div>
                <SmsConsentText />
              </div>
              <figcaption className="mt-2 text-xs text-muted-foreground">Settings &gt; Profile (switch shown off, its default)</figcaption>
            </figure>
            <p className="text-sm text-muted-foreground">
              We record when consent was given and the exact wording shown. Consent is not a condition of any
              purchase. Changing the number turns texts off until the person agrees again for the new number.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">What we send</h2>
            <p>
              Only the notifications a person turns on: reminders, event and task alerts, and family safety
              alerts. No marketing. Message frequency varies with their settings and their family&apos;s
              activity. Message and data rates may apply.
            </p>
            <h3 className="text-base font-medium">Sample messages</h3>
            <ul className="space-y-2">
              {SAMPLES.map((s) => (
                <li key={s} className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm">
                  {s}
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Opting out and help</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                Reply <strong>STOP</strong> (or STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT) to any text to stop all
                texts. You will get one message confirming it. Texts can also be turned off in Settings at any time.
              </li>
              <li>
                Reply <strong>HELP</strong> for help. The reply is: <q>{SMS_HELP_REPLY}</q>
              </li>
              <li>
                Questions: <a href={`mailto:${CONTACT}`} className="text-primary hover:underline">{CONTACT}</a>
              </li>
              <li>Carriers are not liable for delayed or undelivered messages.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Privacy</h2>
            <p>
              Mobile numbers and SMS consent are not sold or shared with third parties or affiliates for
              marketing or promotional purposes. See the{' '}
              <Link href="/terms#sms" className="text-primary hover:underline">SMS Program Terms</Link> and our{' '}
              <Link href="/privacy#sms" className="text-primary hover:underline">Privacy Policy</Link>.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
