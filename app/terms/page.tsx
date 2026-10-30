import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/brand/logo'
import { COMPANY_EMAIL, COMPANY_MAILING_ADDRESS, COMPANY_NAME } from '@/lib/company-info'

export const metadata = {
  title: 'Terms of Service | Togethr',
  description: 'Terms of Service for Togethr family coordination app',
}

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">Last updated: October 29, 2026</p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Togethr ("the Service"), operated by Togethr, LLC ("Togethr", "we", "us"), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Description of Service</h2>
            <p>
              Togethr is a family coordination platform that helps families manage schedules, share locations, 
              and coordinate activities. The Service includes mobile applications and web interfaces.
              The Togethr Android app is published on Google Play by Togethr, LLC.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. User Accounts</h2>
            <p>
              You must create an account to use the Service. You are responsible for maintaining the 
              confidentiality of your account credentials and for all activities under your account.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Togethr is for adults. You must be at least 18 years old to create an account, and you confirm this when you sign up. Children cannot create an account or join a family on their own</li>
              <li>Only a parent or legal guardian can add a child to their family. A parent may also give a child their own supervised login, using a one-time code or invite link the parent creates, and in doing so consents to that child's use of the Service as described in our Privacy Policy</li>
              <li>You must provide accurate and complete information</li>
              <li>You are responsible for all activity on your account</li>
              <li>You must notify us immediately of any unauthorized access</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Family Members and Children</h2>
            <p>
              Togethr allows you to add family members and children to your account. By adding individuals, you represent that:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You have legal authority to add and manage these profiles</li>
              <li>You have obtained necessary consent from adult family members</li>
              <li>You are the parent or legal guardian of any children added to the account, and you consent to the collection and use of their information as described in our Privacy Policy</li>
            </ul>
            <p>
              We do not knowingly collect personal information from anyone under 13 without their parent's
              consent. If we learn that a child has used the Service without a parent, we will delete their
              information and account.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Location Services</h2>
            <p>
              Our Service may include location sharing features. By enabling these features, you consent to 
              the collection and sharing of location data with authorized family members. You can disable 
              location sharing at any time in your settings.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Subscriptions and Billing</h2>
            <p>
              Some features require a paid subscription. Subscription terms, pricing, and cancellation 
              policies are outlined at the time of purchase. Refunds are handled according to the 
              policies of your app store or payment provider.
            </p>
          </section>

          <section className="space-y-4" id="sms">
            <h2 className="text-xl font-semibold">7. SMS Program Terms</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Program:</strong> Togethr Notifications, operated by Togethr, LLC.</li>
              <li>
                <strong>What we send:</strong> the notification texts you turn on in Settings, such as
                reminders, event and task alerts, and family safety alerts (for example SOS and arrival or
                departure alerts). No marketing texts.
              </li>
              <li><strong>How you join:</strong> you add your mobile number and turn on text messages next to the consent wording shown on our <Link href="/sms-consent" className="text-primary hover:underline">text message consent</Link> page.</li>
              <li><strong>Message frequency varies</strong> with your settings and your family&apos;s activity.</li>
              <li><strong>Message and data rates may apply.</strong></li>
              <li>
                <strong>To cancel,</strong> reply STOP to any text, or turn text messages off in Settings. You
                will get one message confirming you have opted out.
              </li>
              <li>
                <strong>For help,</strong> reply HELP or email{' '}
                <a href="mailto:admin@mytogethr.com" className="text-primary hover:underline">admin@mytogethr.com</a>.
              </li>
              <li>Carriers are not liable for delayed or undelivered messages.</li>
              <li>Consent to receive texts is not a condition of any purchase.</li>
              <li>
                Your mobile number and consent are handled as described in our{' '}
                <Link href="/privacy#sms" className="text-primary hover:underline">Privacy Policy</Link>.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Prohibited Conduct</h2>
            <p>You agree not to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Use the Service for any unlawful purpose</li>
              <li>Share false or misleading information</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Use the Service to track individuals without their consent</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Safety Features Are Not an Emergency Service</h2>
            <p>
              <strong>Togethr is not an emergency service and does not replace calling 911 or supervising your children.</strong>{' '}
              In an emergency, call 911 or your local emergency number.
            </p>
            <p>
              Location sharing, arrival and departure alerts, SOS alerts, reminders and other notifications depend on
              things we don&apos;t control, including each device&apos;s settings, battery, GPS and network connection, the
              operating system, and third-party services that deliver push notifications, email and text messages. They can
              be delayed, inaccurate or not delivered at all. Do not rely on the Service as the only way to know where someone
              is or to keep anyone safe.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. Disclaimer of Warranties</h2>
            <p>
              To the fullest extent permitted by law, the Service is provided by Togethr, LLC &quot;as is&quot; and &quot;as
              available&quot;, without warranties of any kind, express or implied, including warranties of merchantability,
              fitness for a particular purpose, accuracy and non-infringement. We do not promise that the Service will be
              uninterrupted, timely, secure or error-free.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">11. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, Togethr, LLC and its members, employees and agents will not be liable
              for any indirect, incidental, special, consequential or punitive damages, or for any loss of data, profits or
              goodwill, arising from or related to your use of, or inability to use, the Service, including any failure,
              delay or inaccuracy of location information, alerts or notifications.
            </p>
            <p>
              To the fullest extent permitted by law, our total liability for all claims arising from or related to the
              Service is limited to the greater of (a) the amount you paid us for the Service in the 12 months before the
              event giving rise to the claim, or (b) US $100.
            </p>
            <p>
              Some jurisdictions do not allow certain warranties to be excluded or liability to be limited, so some of the
              above may not apply to you. Nothing in these Terms limits any rights you have that cannot be waived by law.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the Commonwealth of Massachusetts, without regard to its
              conflict-of-laws rules. Any dispute arising from these Terms or the Service will be brought exclusively in
              the state or federal courts located in Essex County, Massachusetts, and you and Togethr consent to their
              jurisdiction. If any part of these Terms is found unenforceable, the rest remains in effect.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">13. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of significant changes via 
              email or through the Service. Continued use after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">14. Contact Us</h2>
            <p>
              {COMPANY_NAME}
              <br />
              Massachusetts, United States
              <br />
              Mailing address: {COMPANY_MAILING_ADDRESS}
              <br />
              Contact:{' '}
              <a href={`mailto:${COMPANY_EMAIL}`} className="text-primary hover:underline">
                {COMPANY_EMAIL}
              </a>
            </p>
            <p>
              If you have questions about these Terms, please contact us at{' '}
              <a href={`mailto:${COMPANY_EMAIL}`} className="text-primary hover:underline">
                {COMPANY_EMAIL}
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
