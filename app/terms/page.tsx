import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'

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
        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-gray dark:prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">Last updated: October 2026</p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
            <p>
              By accessing or using Togethr ("the Service"), you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Description of Service</h2>
            <p>
              Togethr is a family coordination platform that helps families manage schedules, share locations, 
              and coordinate activities. The Service includes mobile applications and web interfaces.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. User Accounts</h2>
            <p>
              You must create an account to use the Service. You are responsible for maintaining the 
              confidentiality of your account credentials and for all activities under your account.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>You must be at least 18 years old to create an account</li>
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
              <li>You are the legal guardian of any children added to the account</li>
            </ul>
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
              policies of your app store or payment provider. Paid subscriptions, including the Premium
              tier, renew automatically at the end of each billing period until you cancel. You can cancel at
              any time, and your access continues through the end of the period you have paid for.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Prohibited Conduct</h2>
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
            <h2 className="text-xl font-semibold">8. Limitation of Liability</h2>
            <p>
              Togethr is provided "as is" without warranties of any kind. We are not liable for any 
              damages arising from your use of the Service, including but not limited to direct, indirect, 
              incidental, or consequential damages. In particular, we are not liable for any alert,
              notification or location update that is delayed, missed or not delivered, including because of
              loss of connectivity, device or operating-system settings, battery or permission limits, or
              failures of third-party push or messaging providers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Changes to Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of significant changes via 
              email or through the Service. Continued use after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="space-y-4" id="sms">
            <h2 className="text-xl font-semibold">10. Text Messaging (SMS) Terms</h2>
            <p>
              By turning on SMS notifications in Settings and providing your mobile number, you agree to
              receive text messages from Togethr, operated by Nexus Calibration Maintenance Management, LLC, such as event and task reminders, schedule changes and
              family alerts. Consent to receive text messages is not a condition of using the Service.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Message frequency varies based on your reminders and family activity.</li>
              <li>Message and data rates may apply, according to your mobile plan.</li>
              <li>
                Reply STOP at any time to cancel text messages. Reply HELP for help, or contact us at
                admin@mytogethr.com.
              </li>
              <li>Carriers are not liable for delayed or undelivered messages.</li>
              <li>
                See our <a href="/privacy#sms" className="text-primary hover:underline">Privacy Policy</a> for
                how we handle your phone number. We do not share mobile information with third parties
                for marketing or promotional purposes.
              </li>
            </ul>
          </section>

          <section className="space-y-4" id="safety">
            <h2 className="text-xl font-semibold">11. Safety and Emergency Features</h2>
            <p>
              Togethr includes safety features such as SOS alerts and parent-initiated emergency alerts to a
              child's device. Some of these features may require a Premium subscription.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>These features are a convenience and are not a substitute for calling 911 or local emergency services.</li>
              <li>Delivery is not guaranteed and depends on connectivity, device settings, permissions and third-party services.</li>
              <li>Emergency alerts may be rate-limited to prevent abuse.</li>
              <li>You agree to use these features only for genuine safety purposes and not to harass, frighten or mislead anyone.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12. Contact Us</h2>
            <p>
              If you have questions about these Terms, please contact us at{' '}
              <a href="mailto:admin@mytogethr.com" className="text-primary hover:underline">
                admin@mytogethr.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
