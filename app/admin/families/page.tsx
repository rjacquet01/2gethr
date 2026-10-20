'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getAdminAccessToken } from '@/hooks/use-admin-auth'
import { Search, Users, ChevronLeft, ChevronRight, Crown } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { planName } from '@/lib/admin-tier-breakdown'

interface FamilyData {
  id: string
  name: string
  inviteCode: string
  memberCount: number
  childCount: number
  subscriptionTier: string
  subscriptionStatus: string
  createdAt: string
  ownerEmail: string
  ownerName: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function AdminFamiliesPage() {
  const [families, setFamilies] = useState<FamilyData[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState<string>('all')

  useEffect(() => {
    loadFamilies()
  }, [pagination.page, tierFilter])

  async function loadFamilies(searchQuery?: string) {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: '20',
      })
      if (searchQuery || search) params.set('search', searchQuery || search)
      if (tierFilter !== 'all') params.set('tier', tierFilter)

      const token = getAdminAccessToken()
      const res = await fetch(`/api/admin/families?${params}`, { 
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setFamilies(data.families || [])
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 })
      }
    } catch (error) {
      console.error('Failed to load families:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPagination(p => ({ ...p, page: 1 }))
    loadFamilies()
  }

  function getTierBadgeVariant(tier: string) {
    switch (tier) {
      case 'PREMIUM_PLUS': return 'default'
      case 'PREMIUM': return 'secondary'
      default: return 'outline'
    }
  }

  function getStatusBadgeVariant(status: string) {
    switch (status) {
      case 'ACTIVE': return 'default'
      case 'TRIALING': return 'secondary'
      case 'PAST_DUE': return 'destructive'
      default: return 'outline'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Families</h1>
        <p className="text-muted-foreground">Manage family accounts and subscriptions</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4">
            <form onSubmit={handleSearch} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by family name, owner email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="submit">Search</Button>
            </form>
            <Select value={tierFilter} onValueChange={(v) => { setTierFilter(v); setPagination(p => ({ ...p, page: 1 })) }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Subscription" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="FREE">{planName('FREE')}</SelectItem>
                <SelectItem value="PREMIUM">{planName('PREMIUM')}</SelectItem>
                <SelectItem value="PREMIUM_PLUS">{planName('PREMIUM_PLUS')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : families.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No families found
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Family</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {families.map((family) => (
                    <TableRow key={family.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{family.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{family.inviteCode}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{family.ownerName}</p>
                          <p className="text-xs text-muted-foreground">{family.ownerEmail}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span>{family.memberCount}</span>
                          {family.childCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({family.childCount} children)
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getTierBadgeVariant(family.subscriptionTier)}>
                          {family.subscriptionTier === 'PREMIUM_PLUS' && <Crown className="h-3 w-3 mr-1" />}
                          {planName(family.subscriptionTier)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(family.subscriptionStatus)}>
                          {family.subscriptionStatus || 'N/A'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(family.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Link href={`/admin/families/${family.id}`}>
                          <Button variant="outline" size="sm">View</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              <div className="flex items-center justify-between pt-4">
                <p className="text-sm text-muted-foreground">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                  {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
                  {pagination.total} families
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
