import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Logo, LogoIcon } from '@/components/logo'
import { 
  Calendar, 
  MapPin, 
  Bell, 
  Users, 
  CheckCircle2,
  ArrowRight,
  Lock,
  Menu
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

export default function HomePage() {
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
      <section className="py-12 sm:py-20 lg:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="flex justify-center mb-6">
            <LogoIcon size="xl" />
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-6xl font-bold text-foreground mb-4 sm:mb-6 text-balance">
            Family coordination
            <span className="text-primary"> made simple</span>
          </h1>
          <p className="text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-pretty">
            Keep your family connected with shared calendars, location sharing, and smart notifications. 
            Togethr makes coordinating busy family life effortless.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild className="h-12 px-8">
              <Link href="/register">
                Start Free Trial
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-8">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-muted/30">
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
              <Card key={feature.title} className="border-border/50">
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

      {/* CTA */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-8 lg:p-12 text-center">
              <h2 className="text-2xl lg:text-3xl font-bold text-foreground mb-4">
                Ready to get your family organized?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                Join thousands of families who use Togethr to stay connected and coordinated.
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
