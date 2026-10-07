import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/logo'

export const metadata = {
  title: 'Privacy Policy | Togethr',
  description: 'Privacy Policy for Togethr family coordination app',
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
          <p className="text-muted-foreground">Last updated: March 2026</p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">1. Introduction</h2>
            <p>
              Togethr ("we", "our", or "us") is committed to protecting your privacy. This Privacy Policy 
              explains how we collect, use, and safeguard your information when you use our family 
              coordination service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">2. Information We Collect</h2>
            
            <h3 className="text-lg font-medium">Personal Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Name and email address</li>
              <li>Phone number (optional, for notifications)</li>
              <li>Family member and children profiles</li>
              <li>Profile photos</li>
            </ul>

            <h3 className="text-lg font-medium">Usage Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Calendar events and schedules</li>
              <li>Location data (when enabled)</li>
              <li>Device information and app usage</li>
              <li>Communication preferences</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide and improve our Service</li>
              <li>Enable family coordination features</li>
              <li>Send notifications and reminders</li>
              <li>Process payments for premium features</li>
              <li>Respond to support requests</li>
              <li>Ensure the safety and security of our platform</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">4. Location Data</h2>
            <p>
              If you enable location sharing, we collect location data to share with your authorized 
              family members. This data is:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Only shared with family members you authorize</li>
              <li>Encrypted in transit and at rest</li>
              <li>Retained according to your subscription plan limits</li>
              <li>Deleted when you disable location sharing or delete your account</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">5. Data Sharing</h2>
            <p>We do not sell your personal information. We may share data with:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Family members you authorize within the app</li>
              <li>Service providers who help operate our platform</li>
              <li>Law enforcement when required by law</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">6. Children's Privacy</h2>
            <p>
              Togethr allows parents to create profiles for their children. We collect minimal 
              information about children and do not knowingly collect personal information from 
              children under 13 without parental consent. Parents can manage and delete their 
              children's data at any time.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">7. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your data, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Encryption of data in transit and at rest</li>
              <li>Secure authentication with password hashing</li>
              <li>Regular security audits and monitoring</li>
              <li>Access controls and audit logging</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">8. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and data</li>
              <li>Export your data</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">9. Data Retention</h2>
            <p>
              We retain your data for as long as your account is active. After account deletion, 
              we retain certain data for up to 30 days for recovery purposes, after which it is 
              permanently deleted. Some data may be retained longer for legal or compliance purposes.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy periodically. We will notify you of significant 
              changes via email or through the Service.
            </p>
          </section>

          <section className="space-y-4" id="sms">
            <h2 className="text-xl font-semibold">11. Text Messaging (SMS)</h2>
            <p>
              If you choose to receive text messages, we use the mobile phone number you give us to send
              notifications you asked for, such as event and task reminders, schedule changes and
              family alerts. Text messages are optional: we only send them after you turn on SMS
              notifications in Settings and provide your number, and you can turn them off there at any time.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Message frequency varies based on your reminders and family activity.</li>
              <li>Message and data rates may apply.</li>
              <li>Reply STOP at any time to unsubscribe, or HELP for help.</li>
              <li>
                No mobile information will be shared with third parties or affiliates for
                marketing or promotional purposes. Text messaging opt-in data and consent are not shared
                with any third parties, except service providers that deliver the messages for us.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold">12. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or your data, please contact us at{' '}
              <a href="mailto:info@nexuscmm.com" className="text-primary hover:underline">
                info@nexuscmm.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
