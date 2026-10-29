'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ArrowLeft, HelpCircle, Mail } from 'lucide-react'
import { useUpgradeWording } from '@/components/upgrade-gate'
import { IN_APP_PLANS_COPY } from '@/lib/plan-limits'
import { SUBSCRIPTION_TIERS, annualSavingsPercent, centsToDisplay, TRIAL_DAYS } from '@/lib/subscription-tiers'

// Plan names, prices and text-alert allowances come from lib/subscription-tiers.ts.
const FREE = SUBSCRIPTION_TIERS.FREE
const PLUS = SUBSCRIPTION_TIERS.PREMIUM
const PREMIUM = SUBSCRIPTION_TIERS.PREMIUM_PLUS

const faqs = [
  {
    category: 'Getting Started',
    questions: [
      {
        question: 'How do I create a family account?',
        answer: 'Sign up with your email address and follow the onboarding steps to create your family. Then invite family members from the Family page by sharing the invite code or join link.'
      },
      {
        question: 'How do I invite family members?',
        answer: 'Open the Family page and generate an invite code. You can share the code or a join link by text, email, or any app on your phone. Each invite code expires after 7 days, and you can generate a new one at any time.'
      },
      {
        question: 'Can I be part of multiple families?',
        answer: 'Yes, you can be a member of multiple family groups. Switch between families using the family selector in the top navigation. Each family has its own calendar, tasks, and settings.'
      },
    ]
  },
  {
    category: 'Calendar & Events',
    questions: [
      {
        question: 'How do I create a new event?',
        answer: 'Click the "+" button on the calendar page or navigate to Calendar > New Event. Fill in the event details including title, date, time, and optionally add a location, description, or recurring schedule.'
      },
      {
        question: 'How do recurring events work?',
        answer: 'When creating an event, you can set it to repeat daily, weekly, monthly, or yearly. You can also customize which days of the week it occurs and set an end date or number of occurrences.'
      },
      {
        question: 'Can I sync with Google Calendar or other calendars?',
        answer: 'Yes. Go to Settings > Calendar & Task Sync to connect Google Calendar (events and Google Tasks) or Apple Calendar. You can also import iCal (.ics) files. Connected calendars sync automatically.'
      },
      {
        question: 'How do I set up event reminders?',
        answer: `When creating or editing an event, choose how long before it starts you want to be reminded. Reminders arrive by push notification and email. Text message alerts are opt-in: a signed-in adult adds their mobile number in Settings > Profile and turns on text messages. Texts cover event and task reminders, task assignments, arrival alerts for saved places, and family safety alerts. ${PLUS.name} includes ${PLUS.limits.smsMonthlyQuota} texts a month and ${PREMIUM.name} includes ${PREMIUM.limits.smsMonthlyQuota}; urgent safety alerts don't count toward the limit. Message and data rates may apply. Reply STOP to any text to opt out, or HELP for help. Choose your default reminder times and turn each notification type on or off in Settings > Notifications. Custom reminder times are available on ${PLUS.name} and ${PREMIUM.name}.`
      },
    ]
  },
  {
    category: 'Tasks & Assignments',
    questions: [
      {
        question: 'How do I assign a task to a family member?',
        answer: 'When creating a task, use the "Assign to" dropdown to select a family member. They will receive a notification about the new task and it will appear in their task list.'
      },
      {
        question: 'What do the different task statuses mean?',
        answer: 'Tasks can have the following statuses: Pending (not started), In Progress (being worked on), On Hold (temporarily paused), Pending Approval (awaiting parent/admin review), and Completed (finished).'
      },
      {
        question: 'How does the approval workflow work?',
        answer: 'For families with children, tasks can be set to require parent approval when marked complete. The parent will receive a notification and can approve or request revisions before the task is fully completed.'
      },
    ]
  },
  {
    category: 'Location Sharing',
    questions: [
      {
        question: 'How do I enable location sharing?',
        answer: `Go to the Location page and click "Enable Location Sharing". You'll need to grant location permissions in your browser or mobile app. Live location is included on every plan and can be turned off at any time. Free shares live location for up to ${FREE.limits.maxLocationSharers} family members at once and includes ${FREE.limits.maxSavedPlaces} saved places with no arrival/departure alerts; ${PLUS.name} shares for up to ${PLUS.limits.maxLocationSharers} members at once and includes ${PLUS.limits.maxSavedPlaces} saved places with arrival and departure alerts on ${PLUS.limits.maxAlertPlaces} of them; ${PREMIUM.name} shares for the whole family and includes ${PREMIUM.limits.maxSavedPlaces} saved places with alerts on every one.`
      },
      {
        question: 'Who can see my location?',
        answer: 'Only members of your family group can see your location when you have sharing enabled. You control your sharing settings and can turn it off at any time from the Location page.'
      },
      {
        question: 'How do geofences work?',
        answer: `Geofences are virtual boundaries around saved places such as home, school, or work. When a family member arrives at or leaves a geofenced place, designated family members receive an alert. Add places and turn on geofence alerts from the Places page. ${PLUS.name} includes alerts on ${PLUS.limits.maxAlertPlaces} places; ${PREMIUM.name} includes them on every saved place.`
      },
    ]
  },
  {
    category: 'Subscription & Billing',
    questions: [
      {
        question: 'What features are included in each plan?',
        answer: `Free: shared family calendar and tasks (${FREE.limits.maxEventsPerMonth} new events a month, ${FREE.limits.maxActiveReminders} active reminders), live location for ${FREE.limits.maxLocationSharers} family members with ${FREE.limits.maxSavedPlaces} saved places (no arrival/departure alerts), ${FREE.limits.maxBoardUploads} photo uploads on the family board, ${FREE.limits.pushMonthlyQuota} notifications a month, up to ${FREE.limits.maxFamilyMembers} members and ${FREE.limits.maxChildren} children, live location only (no trail) and ${FREE.limits.historyDays} days of past events. ${PLUS.name} ($${centsToDisplay(PLUS.priceMonthlyCents)}/month or $${centsToDisplay(PLUS.priceAnnualCents)}/year): up to ${PLUS.limits.maxFamilyMembers} members and ${PLUS.limits.maxChildren} children, live location for ${PLUS.limits.maxLocationSharers} members, ${PLUS.limits.maxSavedPlaces} saved places, ${PLUS.limits.maxEventsPerMonth} new events a month, ${PLUS.limits.maxActiveReminders} active reminders, ${PLUS.limits.maxBoardUploads} board photo uploads, ${PLUS.limits.pushMonthlyQuota.toLocaleString("en-US")} notifications a month, arrival and departure alerts on ${PLUS.limits.maxAlertPlaces} places, ${PLUS.limits.smsMonthlyQuota} opt-in text alerts a month, custom reminder times, advanced recurring events, calendar export, priority support, a ${PLUS.limits.locationTrailDays}-day location trail and ${PLUS.limits.historyDays} days of past events. ${PREMIUM.name} ($${centsToDisplay(PREMIUM.priceMonthlyCents)}/month or $${centsToDisplay(PREMIUM.priceAnnualCents)}/year): everything in ${PLUS.name}, plus up to ${PREMIUM.limits.maxFamilyMembers} members, unlimited children, ${PREMIUM.limits.maxSavedPlaces} saved places, live location for the whole family, unlimited events, reminders and notifications, ${PREMIUM.limits.maxBoardUploads} board photo uploads, arrival and departure alerts on every place, ${PREMIUM.limits.smsMonthlyQuota} opt-in text alerts a month, and emergency alerts to your child. Safety alerts (arrivals, departures, SOS and emergencies) are never limited on any plan, and urgent safety texts don't count toward the text limit. Annual billing saves ${annualSavingsPercent(PLUS)}% (about 2 months free). New members get a ${TRIAL_DAYS}-day free Premium trial.`
      },
      {
        question: 'How do I upgrade my subscription?',
        answer: 'Go to Subscription to view plans and upgrade or start your free trial. Payment is processed securely through Stripe. You can change or cancel your plan at any time from Manage Billing.'
      },
      {
        question: 'Can I get a refund?',
        answer: `Refunds are handled according to our Terms of Service and the policies of your payment provider. There is no money-back guarantee, but you can start with a ${TRIAL_DAYS}-day free Premium trial (no card needed) to try the paid features, and cancel any time to prevent future charges. If you were charged in error, contact support.`
      },
      {
        question: 'How do I cancel my subscription?',
        answer: 'Go to Subscription and click Cancel Subscription (or Manage Billing) to open the secure Stripe billing portal. Your plan stays active until the end of the current billing period, then reverts to Free. If you are on the free trial, use Cancel Trial instead.'
      },
    ]
  },
  {
    category: 'Account & Security',
    questions: [
      {
        question: 'How do I change my password?',
        answer: 'Go to Settings > Security and click Change Password. You will need to enter your current password and then your new password.'
      },
      {
        question: 'How do I enable two-factor authentication?',
        answer: 'Go to Settings > Security. Scan the setup code with an authenticator app such as Google Authenticator or Authy, then enter the 6-digit code to turn on two-factor authentication.'
      },
      {
        question: 'How do I delete my account?',
        answer: 'Go to Settings and scroll to the Danger Zone, then click Delete Account and confirm with your email. This is permanent and removes your data.'
      },
      {
        question: 'What data do you collect?',
        answer: 'We collect only the data necessary to provide our services: your email, profile information, calendar events, tasks, and optionally location data if enabled. We never sell your data. See our Privacy Policy for full details.'
      },
    ]
  },
]

// Inside the Android app: no prices, upgrade steps or billing links (Google Play rules).
const IN_APP_BILLING = {
  category: 'Subscription & Billing',
  questions: [{ question: 'How do I manage my plan?', answer: IN_APP_PLANS_COPY }],
}

export default function FAQsPage() {
  const { inApp } = useUpgradeWording()
  const shown = inApp ? faqs.map((c) => (c.category === IN_APP_BILLING.category ? IN_APP_BILLING : c)) : faqs
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/support">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Frequently Asked Questions</h1>
          <p className="text-muted-foreground">Find answers to common questions</p>
        </div>
      </div>

      {/* FAQ Categories */}
      <div className="space-y-6">
        {shown.map((category) => (
          <Card key={category.category}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HelpCircle className="w-5 h-5" />
                {category.category}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                {category.questions.map((faq, index) => (
                  <AccordionItem key={index} value={`${category.category}-${index}`}>
                    <AccordionTrigger className="text-left">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Still Need Help */}
      <Card className="bg-muted/50">
        <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 p-6">
          <div className="text-center sm:text-left">
            <CardTitle className="text-lg mb-1">Still have questions?</CardTitle>
            <CardDescription>
              Can't find what you're looking for? Our support team is here to help.
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" asChild>
              <a href="mailto:admin@mytogethr.com">
                <Mail className="w-4 h-4 mr-2" />
                Email Us
              </a>
            </Button>
            <Button asChild>
              <Link href="/support/new">
                Create Support Ticket
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
