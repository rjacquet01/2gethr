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
        answer: 'To create a family account, sign up with your email address and follow the onboarding process. You can then invite family members by going to Settings > Family > Invite Members and sharing the generated invite code or link.'
      },
      {
        question: 'How do I invite family members?',
        answer: 'Navigate to Settings > Family > Invite Members. You can generate an invite code that family members can use to join, or send them a direct invite link via email. Each invite code expires after 7 days for security.'
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
        answer: 'Calendar sync with external providers like Google Calendar and Apple Calendar is planned for a future update. Currently, you can manually add events or use our mobile app for quick entry.'
      },
      {
        question: 'How do I set up event reminders?',
        answer: 'When creating or editing an event, you can add reminders that will notify you via push notification, email, or SMS (Premium feature) before the event starts. Default reminder times can be set in Settings > Notifications.'
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
        answer: 'Geofences are virtual boundaries around locations like home, school, or work. When a family member enters or leaves a geofenced area, designated family members receive a notification. Set up geofences in Location > Saved Places.'
      },
    ]
  },
  {
    category: 'Subscription & Billing',
    questions: [
      {
        question: 'What features are included in each plan?',
        answer: 'Free: shared calendar, tasks, and basic live location with 2 saved places. Basic: more members, 15 saved places, SMS notifications, advanced reminders. Premium: geofence arrival and departure alerts, 50 saved places, phone alerts, and 1 year of history.'
      },
      {
        question: 'How do I upgrade my subscription?',
        answer: 'Go to Settings > Subscription to view available plans and upgrade. Payment is processed securely through Stripe. You can upgrade, downgrade, or cancel at any time.'
      },
      {
        question: 'Can I get a refund?',
        answer: 'We offer a 14-day money-back guarantee for new subscriptions. If you\'re not satisfied, contact support within 14 days of your purchase for a full refund. After 14 days, subscriptions are non-refundable but you can cancel to prevent future charges.'
      },
      {
        question: 'How do I cancel my subscription?',
        answer: 'Navigate to Settings > Subscription > Manage Subscription and click "Cancel Plan". Your subscription will remain active until the end of your current billing period, then revert to the free plan.'
      },
    ]
  },
  {
    category: 'Account & Security',
    questions: [
      {
        question: 'How do I change my password?',
        answer: 'Go to Settings > Profile > Security and click "Change Password". You\'ll need to enter your current password and then your new password twice to confirm.'
      },
      {
        question: 'How do I enable two-factor authentication?',
        answer: 'Two-factor authentication (2FA) can be enabled in Settings > Profile > Security. We support authenticator apps like Google Authenticator or Authy for an extra layer of security.'
      },
      {
        question: 'How do I delete my account?',
        answer: 'To delete your account, go to Settings > Profile > Delete Account. This action is permanent and will remove all your data. If you\'re the only admin of a family, you\'ll need to transfer ownership or delete the family first.'
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
