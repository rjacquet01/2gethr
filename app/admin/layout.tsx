'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, Home, CreditCard,
  TicketIcon, AlertTriangle, LogOut,
  Menu, X, ChevronDown, Settings, Mail, Bell,
  ArrowUpCircle
} from 'lucide-react'
import { Logo, LogoIcon } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAdminAccessToken, clearAdminTokens } from '@/hooks/use-admin-auth'

interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  roles: string[]
  permissions: string[]
}

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: LayoutDashboard, permission: null },
  { name: 'Users', href: '/admin/users', icon: Users, permission: 'users.read' },
  { name: 'Families', href: '/admin/families', icon: Home, permission: 'families.read' },
  { name: 'Subscriptions', href: '/admin/subscriptions', icon: CreditCard, permission: 'subscriptions.read' },
  { name: 'Upgrade Requests', href: '/admin/upgrades', icon: ArrowUpCircle, permission: null },
  { name: 'Support Tickets', href: '/admin/tickets', icon: TicketIcon, permission: 'support.read' },
  { name: 'Risk Flags', href: '/admin/risk-flags', icon: AlertTriangle, permission: 'trust.read' },
  { name: 'Weekly Digest', href: '/admin/digest', icon: Mail, permission: null },
  { name: 'Notifications', href: '/admin/notifications', icon: Bell, permission: null },
  { name: 'Settings', href: '/admin/settings', icon: Settings, permission: null },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    async function checkAuth() {
      try {
        const token = getAdminAccessToken()
        if (!token) {
          // Check if setup is needed
          const setupRes = await fetch('/api/admin/auth/setup')
          const setupData = await setupRes.json()
          if (setupData.setupRequired) {
            router.push('/admin/setup')
          } else {
            router.push('/admin/login')
          }
          return
        }
        
        const res = await fetch('/api/admin/auth/me', { 
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setAdmin(data.admin)
        } else {
          clearAdminTokens()
          router.push('/admin/login')
        }
      } catch {
        clearAdminTokens()
        router.push('/admin/login')
      } finally {
        setLoading(false)
      }
    }
    
    // Don't check auth on login/setup pages
    if (pathname === '/admin/login' || pathname === '/admin/setup') {
      setLoading(false)
      return
    }
    
    checkAuth()
  }, [pathname, router])

  const handleLogout = async () => {
    const token = getAdminAccessToken()
    await fetch('/api/admin/auth/logout', { 
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    })
    clearAdminTokens()
    router.push('/admin/login')
  }

  const hasPermission = (permission: string | null) => {
    if (!permission) return true
    if (!admin) return false
    if (admin.roles.includes('SUPER_ADMIN')) return true
    return admin.permissions.includes(permission)
  }

  // Show nothing while loading, or show children directly for login/setup pages
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sidebar">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sidebar-primary" />
      </div>
    )
  }

  // Don't wrap login/setup pages with the admin layout
  if (pathname === '/admin/login' || pathname === '/admin/setup') {
    return <>{children}</>
  }

  if (!admin) {
    return null
  }

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground transform transition-transform lg:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex h-16 items-center gap-2 px-4 border-b border-sidebar-border">
          <LogoIcon size="sm" />
          <span className="font-semibold text-lg text-sidebar-foreground">Admin</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            if (!hasPermission(item.permission)) return null
            const isActive = pathname === item.href || 
              (item.href !== '/admin' && pathname.startsWith(item.href))
            
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            )
          })}
        </nav>

        {/* Admin info at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground text-sm font-medium">
              {admin.firstName[0]}{admin.lastName[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{admin.firstName} {admin.lastName}</p>
              <p className="text-xs text-sidebar-foreground/60 truncate">{admin.roles[0]}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 bg-background border-b flex items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          
          <div className="flex-1" />
          
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">Logged in as</span>
            <span className="font-medium text-foreground">{admin.email}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
