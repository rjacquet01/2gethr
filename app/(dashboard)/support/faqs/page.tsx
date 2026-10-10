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
        answer: 'When creating or editing an event, choose how long before it starts you want to be reminded. Reminders arrive by push notification and email, and by text message on the Basic and Premium plans. Choose your default reminder times and turn each notification type on or off in Settings > Notifications. Custom reminder times are a Premium feature.'
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
        answer: 'Go to the Location page and click "Enable Location Sharing". You\'ll need to grant location permissions in your browser or mobile app. Basic live location is included on every plan (with 2 saved places) and can be disabled at any time.'
      },
      {
        question: 'Who can see my location?',
        answer: 'Only members of your family group can see your location when you have sharing enabled. You control your sharing settings and can turn it off at any time from the Location page.'
      },
      {
        question: 'How do geofences work?',
        answer: 'Geofences are virtual boundaries around saved places such as home, school, or work. When a family member arrives at or leaves a geofenced place, designated family members receive an alert. Add places and turn on geofence alerts from the Places page. Geofence alerts are a Premium feature.'
      },
    ]
  },
  {
    category: 'Subscription & Billing',
    questions: [
      {
        question: 'What features are included in each plan?',
        answer: 'Free: shared family calendar and tasks, live family location with 2 saved places, up to 4 members, 30 days of history. Basic ($2.99/month): up to 6 members, 15 saved places, SMS notifications, advanced recurring events, calendar export, 90 days of history. Premium ($4.99/month): up to 12 members, 50 saved places, geofence arrival and departure alerts, custom reminder times, and 1 year of history. Annual billing is discounted. New members get a 14-day free Premium trial.'
      },
      {
        question: 'How do I upgrade my subscription?',
        answer: 'Go to Subscription to view plans and upgrade or start your free trial. Payment is processed securely through Stripe. You can change or cancel your plan at any time from Manage Billing.'
      },
      {
        question: 'Can I get a refund?',
        answer: 'Refunds are handled according to our Terms of Service and the policies of your payment provider. There is no money-back guarantee, but you can start with a 14-day free Premium trial (no card needed) to try the paid features, and cancel any time to prevent future charges. If you were charged in error, contact support.'
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

export default function FAQsPage() {
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
        {faqs.map((category) => (
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
