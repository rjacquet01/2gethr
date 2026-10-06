'use client'

import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'
import { useNotifications } from '@/hooks/use-notifications'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { FavoritesDropdown } from '@/components/favorites-dropdown'
import { CalendarAutoSync } from '@/components/calendar-auto-sync'
import { Logo, LogoIcon } from '@/components/logo'
import { FamilySwitcher } from '@/components/family-switcher'
import { 
  Home, 
  Calendar, 
  Users, 
  MapPin, 
  Bell, 
  Settings,
  LogOut,
  Crown,
  Menu,
  X,
  Navigation,
  ListTodo,
  HelpCircle,
  Archive
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

// '/dashboard' is both the Home route AND the prefix every other dashboard
// route is nested under (/dashboard/reminders, /dashboard/archive, ...), so
// the old `pathname === href || pathname.startsWith(href + '/')` check
// matched Home for every one of those too - Home and whichever sub-page
// you were on both lit up at once. Home only ever matches its own exact
// path; every other item keeps the prefix match so a deeper route (e.g. a
// future /tasks/[id]) still highlights its parent tab.
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

const navItems = [
  { href: '/dashboard', icon: Home, label: 'Home' },
  { href: '/calendar', icon: Calendar, label: 'Calendar' },
  { href: '/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/dashboard/reminders', icon: Bell, label: 'Reminders' },
  { href: '/family', icon: Users, label: 'Family' },
  { href: '/location', icon: Navigation, label: 'Location' },
  { href: '/places', icon: MapPin, label: 'Places' },
  { href: '/dashboard/archive', icon: Archive, label: 'Archive' },
  { href: '/subscription', icon: Crown, label: 'Subscription' },
  { href: '/support', icon: HelpCircle, label: 'Support' },
]

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isLoading, isAuthenticated, logout } = useAuth()
  const { unreadCount } = useNotifications()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="w-8 h-8 text-primary" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  const userInitials = user?.displayName
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'

  return (
    <div className="min-h-screen bg-background">
      <CalendarAutoSync />
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center border-b border-sidebar-border px-6">
            <Logo size="md" textClassName="text-sidebar-foreground" />
          </div>

          {/* Family switcher (only shown when you belong to 2+ families) */}
          <div className="px-4 pt-4 empty:hidden">
            <FamilySwitcher variant="sidebar" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => {
              const isActive = isNavItemActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* User Section */}
          <div className="border-t border-sidebar-border p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Account menu"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-sidebar-accent transition-colors"
                >
                  <Avatar className="w-9 h-9 ring-2 ring-sidebar-border">
                    <AvatarImage 
                      src={user?.avatarUrl || undefined} 
                      alt={user?.displayName || 'User avatar'}
                    />
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-sm font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-sidebar-foreground truncate">
                      {user?.displayName || 'User'}
                    </p>
                    <p className="text-xs text-sidebar-foreground/60 truncate">
                      {user?.email}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/subscription">
                    <Crown className="mr-2 h-4 w-4" />
                    Subscription
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 border-b border-border bg-background lg:hidden safe-area-top">
        <div className="flex h-full items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              className="h-10 w-10 touch-target no-select"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <Logo size="xs" />
          </div>
          <div className="flex items-center gap-1">
            <FamilySwitcher variant="compact" />
            <FavoritesDropdown />
            <Button variant="ghost" size="icon" asChild className="relative h-10 w-10 touch-target">
              <Link href="/notifications">
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Link>
            </Button>
            <Avatar className="w-8 h-8 ring-2 ring-border touch-target">
              <AvatarImage 
                src={user?.avatarUrl || undefined} 
                alt={user?.displayName || 'User avatar'}
              />
              <AvatarFallback className="text-xs font-medium">{userInitials}</AvatarFallback>
            </Avatar>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <nav className="absolute left-0 top-16 bottom-0 w-64 bg-background border-r border-border p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = isNavItemActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground/70 hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                </Link>
              )
            })}
            <div className="pt-4 border-t border-border mt-4">
              <Link
                href="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-foreground/70 hover:bg-muted"
              >
                <Settings className="w-5 h-5" />
                Settings
              </Link>
              <button
                onClick={() => {
                  setMobileMenuOpen(false)
                  logout()
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                <LogOut className="w-5 h-5" />
                Sign out
              </button>
            </div>
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main className="lg:pl-64 pt-14 lg:pt-0 min-h-screen">
        <div className="p-3 sm:p-4 lg:p-8 pb-20 lg:pb-8">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm lg:hidden safe-area-bottom">
        <div className="flex h-16 items-center justify-around px-1 landscape-compact">
          {[
            { href: '/dashboard', icon: Home, label: 'Home' },
            { href: '/calendar', icon: Calendar, label: 'Calendar' },
            { href: '/tasks', icon: ListTodo, label: 'Tasks' },
            { href: '/family', icon: Users, label: 'Family' },
            { href: '/location', icon: Navigation, label: 'Location' },
          ].map((item) => {
            const isActive = isNavItemActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 py-1.5 px-2 sm:px-4 min-w-[56px] sm:min-w-[64px] rounded-xl transition-all touch-target no-select',
                  isActive 
                    ? 'text-primary bg-primary/10 scale-105' 
                    : 'text-muted-foreground active:scale-95 active:bg-muted'
                )}
              >
                <item.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                <span className="text-[9px] sm:text-[10px] font-medium leading-tight">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
