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
        answer: 'Sign up with your email address, then choose "Create a Family" during onboarding. Once your family exists, open the Family page to invite members.'
      },
      {
        question: 'How do I invite family members?',
        answer: 'Open the Family page and use the invite code card. Tap Share Invite to send a join link plus the code by email or text, or copy the code. The link opens Togethr with the code already filled in. Only the family owner can generate invites, and each invite code expires after 7 days (use New Code to make a fresh one).'
      },
      {
        question: 'Can I be part of multiple families?',
        answer: 'Yes. If you belong to more than one family, a family switcher appears at the top of the sidebar (and in the mobile header). Pick a family and the Calendar, Tasks, Family, Location and Places pages show that family. Each family has its own calendar, tasks, and settings.'
      },
    ]
  },
  {
    category: 'Calendar & Events',
    questions: [
      {
        question: 'How do I create a new event?',
        answer: 'Open the Calendar and tap New Event (or use the + button). Fill in the title, date and time, and optionally add a location, description, participants, or a repeat schedule.'
      },
      {
        question: 'How do recurring events work?',
        answer: 'When creating an event, turn on Recurring Event and choose daily, weekly, every 2 weeks, monthly, yearly, weekdays, or custom days of the week. Then choose when it ends: never (the next 12 months are scheduled), on a date, or after a number of occurrences. Each occurrence is created as its own event.'
      },
      {
        question: 'Can I sync with Google Calendar or other calendars?',
        answer: 'Yes. Go to Settings > Calendar & Task Sync to connect Google or Apple Calendar, or to import a .ics file from Outlook, Android, or iOS.'
      },
      {
        question: 'How do I set up event reminders?',
        answer: 'When creating an event, choose one or more reminders and the channels to notify through (in-app, push, email, or SMS - SMS is available on the Basic and Premium plans). To change the reminders new events start with, go to Settings > Notifications > Default Reminder Times.'
      },
    ]
  },
  {
    category: 'Tasks & Assignments',
    questions: [
      {
        question: 'How do I assign a task to a family member?',
        answer: 'When creating a task, use the "Assign to Family Member" dropdown (or "Or Assign to Child") to choose who it\'s for. They are notified about the new task and it appears in their task list.'
      },
      {
        question: 'What do the different task statuses mean?',
        answer: 'Pending (not started), In Progress (being worked on), On Hold (temporarily paused), Awaiting Approval (finished and waiting for a parent to review), Completed (done and approved), and Cancelled (no longer needed). Use the Status menu on a task to change it.'
      },
      {
        question: 'How does the approval workflow work?',
        answer: 'Turn on "Require Approval" when creating a task. When the assignee marks it complete, it moves to Awaiting Approval, and a parent can approve it or send it back.'
      },
    ]
  },
  {
    category: 'Location Sharing',
    questions: [
      {
        question: 'How do I enable location sharing?',
        answer: 'Go to the Location page and click "Enable Location Sharing". You\'ll need to grant location permission in your browser or mobile app. Location sharing is available on the Premium plan and can be turned off at any time.'
      },
      {
        question: 'Who can see my location?',
        answer: 'Only members of your family group can see your location when you have sharing enabled. You control your sharing settings and can turn it off at any time from the Location page.'
      },
      {
        question: 'How do geofences work?',
        answer: 'Geofences are virtual boundaries around saved places like home, school, or work. When a family member arrives at or leaves a geofenced place, parents and guardians in the family are notified. Turn geofencing on for a place on the Places page. Geofence alerts are included in the Premium plan.'
      },
    ]
  },
  {
    category: 'Subscription & Billing',
    questions: [
      {
        question: 'What features are included in each plan?',
        answer: 'Free: shared family calendar and tasks, up to 4 family members and 2 children, 30 days of history. Basic: up to 6 family members and 5 children, SMS notifications, advanced recurring events, calendar export, and priority support. Premium: up to 12 family members and unlimited children, plus real-time location sharing, geofence alerts, phone call alerts, custom reminder times, and a year of history. Open the Subscription page for current pricing.'
      },
      {
        question: 'How do I upgrade my subscription?',
        answer: 'Open Subscription in the main menu to view plans and upgrade. Payment is processed securely through Stripe, and we never see or store your card number. Plan changes take effect at the start of your next billing cycle.'
      },
      {
        question: 'Can I get a refund?',
        answer: 'We offer a 14-day money-back guarantee for new subscriptions. If you\'re not satisfied, contact support within 14 days of your purchase for a full refund. After 14 days, subscriptions are non-refundable but you can cancel to prevent future charges.'
      },
      {
        question: 'How do I cancel my subscription?',
        answer: 'Open Subscription and choose Manage Billing to open the secure Stripe billing portal, where you can cancel. Your plan stays active until the end of the current billing period, then reverts to Free.'
      },
    ]
  },
  {
    category: 'Account & Security',
    questions: [
      {
        question: 'How do I change my password?',
        answer: 'Go to Settings > Security and click "Change Password". Enter your current password, then your new password twice. Your other devices will be signed out. If you\'ve forgotten your password, use "Forgot password" on the sign-in page.'
      },
      {
        question: 'How do I enable two-factor authentication?',
        answer: 'Two-factor authentication (2FA) can be turned on in Settings > Security. It works with authenticator apps like Google Authenticator or Authy.'
      },
      {
        question: 'How do I delete my account?',
        answer: 'Go to Settings and scroll to the Danger Zone, then choose Delete Account and confirm with your email address. This is permanent. If you own a family that has other members, ownership is transferred to another member automatically; if you\'re the only member, the family and its subscription are deleted.'
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
              <a href="mailto:info@nexuscmm.com">
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
