'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { Star, MapPin, Calendar, CheckSquare, ChevronDown, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { authFetch } from '@/hooks/use-auth'
import { toast } from 'sonner'

interface FavoriteItem {
  id: string
  item_type: 'task' | 'event' | 'place'
  item_id: string
  created_at: string
  item: {
    id: string
    title?: string
    name?: string
    status?: string
    priority?: string
    due_date?: string
    start_time?: string
    event_type?: string
    address?: string
    icon?: string
    color?: string
  } | null
}

const fetcher = async (url: string) => {
  const res = await authFetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
}

export function FavoritesDropdown() {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; data: FavoriteItem[] }>(
    '/api/favorites',
    fetcher
  )

  const favorites = data?.data || []

  const removeFavorite = async (itemType: string, itemId: string) => {
    try {
      const res = await authFetch(`/api/favorites?type=${itemType}&itemId=${itemId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Removed from favorites')
        mutate()
      }
    } catch {
      toast.error('Failed to remove favorite')
    }
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'task':
        return <CheckSquare className="h-4 w-4 text-blue-500" />
      case 'event':
        return <Calendar className="h-4 w-4 text-green-500" />
      case 'place':
        return <MapPin className="h-4 w-4 text-orange-500" />
      default:
        return <Star className="h-4 w-4" />
    }
  }

  const getLink = (fav: FavoriteItem) => {
    switch (fav.item_type) {
      case 'task':
        return `/tasks/${fav.item_id}`
      case 'event':
        return `/calendar?event=${fav.item_id}`
      case 'place':
        return `/places`
      default:
        return '#'
    }
  }

  const getDisplayName = (fav: FavoriteItem) => {
    if (!fav.item) return 'Unknown'
    return fav.item.title || fav.item.name || 'Untitled'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Favorites">
          <Star className="h-4 w-4" />
          <span className="hidden sm:inline">Favorites</span>
          {favorites.length > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {favorites.length}
            </Badge>
          )}
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Star className="h-4 w-4 text-yellow-500" />
          Your Favorites
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : favorites.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            <Star className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p>No favorites yet</p>
            <p className="text-xs mt-1">Star tasks, events, or places to add them here</p>
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {favorites.map((fav) => (
              <DropdownMenuItem key={fav.id} className="p-0" asChild>
                <div className="flex items-center justify-between w-full px-2 py-2 hover:bg-muted cursor-pointer">
                  <Link href={getLink(fav)} className="flex items-center gap-2 flex-1 min-w-0">
                    {getIcon(fav.item_type)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{getDisplayName(fav)}</p>
                      <p className="text-xs text-muted-foreground capitalize">{fav.item_type}</p>
                    </div>
                  </Link>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      removeFavorite(fav.item_type, fav.item_id)
                    }}
                    className="p-1 hover:bg-background rounded"
                  >
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Hook to add/remove favorites from other components
export function useFavorites() {
  const { data, mutate } = useSWR<{ success: boolean; data: FavoriteItem[] }>(
    '/api/favorites',
    fetcher
  )

  const favorites = data?.data || []

  const isFavorite = (itemType: string, itemId: string) => {
    return favorites.some(f => f.item_type === itemType && f.item_id === itemId)
  }

  const addFavorite = async (itemType: 'task' | 'event' | 'place', itemId: string) => {
    try {
      const res = await authFetch('/api/favorites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType, itemId }),
      })
      if (res.ok) {
        toast.success('Added to favorites')
        mutate()
        return true
      }
      return false
    } catch {
      toast.error('Failed to add favorite')
      return false
    }
  }

  const removeFavorite = async (itemType: string, itemId: string) => {
    try {
      const res = await authFetch(`/api/favorites?type=${itemType}&itemId=${itemId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Removed from favorites')
        mutate()
        return true
      }
      return false
    } catch {
      toast.error('Failed to remove favorite')
      return false
    }
  }

  const toggleFavorite = async (itemType: 'task' | 'event' | 'place', itemId: string) => {
    if (isFavorite(itemType, itemId)) {
      return removeFavorite(itemType, itemId)
    } else {
      return addFavorite(itemType, itemId)
    }
  }

  return {
    favorites,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    mutate,
  }
}
