import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Logo } from '@/components/logo'
import { listTierDefinitions, centsToDisplay } from '@/lib/subscription-tiers'
import { 
  Calendar, 
  MapPin, 
  Bell, 
  Users, 
  CheckCircle2,
  ArrowRight,
  Lock,
  Check,
  UserPlus,
  CalendarPlus,
  ShieldCheck,
} from 'lucide-react'

const features = [
  {
    icon: Calendar,
    title: 'Shared Calendars',
    description: 'Keep everyone on the same page with family-wide event scheduling and coordination.',
  },
  {
    icon: MapPin,
    title: 'Location Sharing',
    description: 'Know when family members arrive safely with optional location sharing and geofence alerts.',
  },
  {
    icon: Bell,
    title: 'Smart Notifications',
    description: 'Stay informed with event reminders, approval requests, and arrival notifications.',
  },
  {
    icon: Users,
    title: 'Role-Based Access',
    description: 'Parents control permissions. Children can request events that need approval.',
  },
  {
    icon: CheckCircle2,
    title: 'Approval Workflow',
    description: 'Review and approve child event requests before they appear on the calendar.',
  },
  {
    icon: Lock,
    title: 'Privacy First',
    description: 'Your family data is encrypted and secure. Location sharing is always optional.',
  },
]

const steps = [
  {
    icon: UserPlus,
    title: 'Create your family',
    description: 'Sign up in a minute and invite everyone with a simple code or link.',
  },
  {
    icon: CalendarPlus,
    title: 'Plan together',
    description: 'Add events, tasks and reminders. Everyone sees what matters to them.',
  },
  {
    icon: ShieldCheck,
    title: 'Stay in the loop',
    description: 'Get reminders, approvals and arrival alerts, with location sharing only when you choose.',
  },
]

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden="true">
      <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-accent/25 via-primary/10 to-transparent blur-2xl" />
      <div className="rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">The Parker Family</p>
            <p className="text-xs text-muted-foreground">Today, 4 things on the plan</p>
          </div>
          <div className="flex -space-x-2">
            {['M', 'D', 'J', 'S'].map((l, i) => (
              <span
                key={l}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-card text-[11px] font-semibold text-white ${['bg-primary', 'bg-accent', 'bg-emerald-500', 'bg-sky-500'][i]}`}
              >
                {l}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-3 p-5">
          {[
            { time: '3:30 PM', title: 'Soccer practice', tag: 'Sports', bar: 'bg-emerald-500' },
            { time: '5:00 PM', title: 'Dentist appointment', tag: 'Medical', bar: 'bg-red-500' },
            { time: '7:00 PM', title: 'Family pizza night', tag: 'Social', bar: 'bg-purple-500' },
          ].map((e) => (
            <div key={e.title} className="flex items-center gap-3 rounded-xl border border-border bg-background p-3">
              <span className={`h-9 w-1 rounded-full ${e.bar}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{e.title}</p>
                <p className="text-xs text-muted-foreground">{e.time}</p>
              </div>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{e.tag}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <p className="flex-1 text-sm text-foreground">Take out the recycling</p>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Awaiting approval</span>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-lg sm:-left-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MapPin className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-foreground">Arrived at school</p>
          <p className="text-[11px] text-muted-foreground">8:02 AM</p>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const tiers = listTierDefinitions()

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur-sm z-50">
        <div className="container mx-auto px-4 h-14 sm:h-16 flex items-center justify-between">
          <Logo size="sm" />
          <div className="hidden sm:flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/pricing">Pricing</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild>
              <Link href="/register">Get Started</Link>
            </Button>
          </div>
          <div className="flex sm:hidden items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/register">Start</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary/[0.06] via-background to-background">
        <div className="container mx-auto grid items-center gap-12 px-4 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16 lg:py-28">
          <div className="text-center lg:text-left">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Calendar, tasks and location for the whole family
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-5 text-balance">
              Family coordination
              <span className="text-primary"> made simple</span>
            </h1>
            <p className="text-lg lg:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-8 text-pretty">
              One shared place for your family&apos;s calendar, chores, reminders and arrival alerts, so nobody has to ask &ldquo;where are we meeting?&rdquo; again.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3">
              <Button size="lg" asChild className="h-12 px-8">
                <Link href="/register">
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-8">
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
            <ul className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" />14-day free trial</li>
              <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" />No credit card required</li>
              <li className="flex items-center gap-1.5"><Check className="h-4 w-4 text-primary" />Cancel anytime</li>
            </ul>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">How it works</h2>
            <p className="text-lg text-muted-foreground">Up and running in three simple steps.</p>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto">
            {steps.map((step, i) => (
              <div key={step.title} className="relative text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
                  <step.icon className="h-6 w-6" />
                </div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent-foreground/70">Step {i + 1}</p>
                <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-pretty">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              Everything your family needs
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Togethr brings all your family coordination tools into one simple, secure app.
            </p>
          </div>
          
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="border-border/50 transition-all hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
                    <feature.icon className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="py-16 sm:py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-3">Simple, family-friendly pricing</h2>
            <p className="text-lg text-muted-foreground">Start with a 14-day free Premium trial. No credit card needed.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
            {tiers.map((tier) => {
              const featured = tier.key === 'PREMIUM_PLUS'
              return (
                <Card
                  key={tier.key}
                  className={featured ? 'border-primary shadow-lg ring-1 ring-primary/20 relative' : 'border-border/60'}
                >
                  {featured && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-accent-foreground">
                      Most complete
                    </span>
                  )}
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold text-foreground">{tier.name}</h3>
                    <p className="text-sm text-muted-foreground mb-4">{tier.description}</p>
                    <p className="mb-5">
                      <span className="text-4xl font-bold text-foreground">
                        {tier.priceMonthlyCents === 0 ? 'Free' : `$${centsToDisplay(tier.priceMonthlyCents)}`}
                      </span>
                      {tier.priceMonthlyCents > 0 && <span className="text-muted-foreground">/month</span>}
                    </p>
                    <ul className="space-y-2.5 mb-6">
                      {tier.featureList.slice(0, 5).map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button asChild variant={featured ? 'default' : 'outline'} className="w-full">
                      <Link href="/register">{tier.priceMonthlyCents === 0 ? 'Get started free' : 'Start free trial'}</Link>
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            <Link href="/pricing" className="underline underline-offset-4 hover:text-foreground">Compare all plans and features</Link>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-8 lg:p-12 text-center">
              <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-4">
                Ready to get your family organized?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Bring your calendar, chores and reminders together in one place. Try every Premium feature free for 14 days.
              </p>
              <Button size="lg" asChild className="h-12 px-8">
                <Link href="/register">
                  Start Your Free Trial
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-6 sm:py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <Logo size="xs" />
            <div className="flex items-center gap-4 sm:gap-6 text-sm text-muted-foreground">
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <a href="mailto:admin@mytogethr.com" className="hover:text-foreground transition-colors">Contact</a>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} Togethr
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
