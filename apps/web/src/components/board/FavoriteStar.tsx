'use client'

import { useState } from 'react'
import { Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { toggleProjectFavorite } from '@/lib/actions/projects'
import { useFavoritesStore } from '@/stores/favoritesStore'
import { cn } from '@/lib/utils/cn'

// Header star next to the save pill. Optimistic: flips instantly, rolls back
// if the server action fails so the UI never lies about persisted state.
// Also patches the shared favoritesStore so the sidebar Favorites group
// live-updates without a refetch.
export function FavoriteStar({ projectId, initialFavorite = false, projectName }: { projectId: string; initialFavorite?: boolean; projectName?: string }) {
  const [favorite, setFavorite] = useState(initialFavorite)

  const syncStore = (value: boolean) => {
    useFavoritesStore.getState().applyToggle(projectId, value, projectName ? { name: projectName } : undefined)
  }

  const handleToggle = async () => {
    const next = !favorite
    setFavorite(next)
    syncStore(next)
    try {
      await toggleProjectFavorite(projectId, next)
    } catch {
      setFavorite(!next)
      syncStore(!next)
    }
  }

  return (
    <motion.button
      whileHover={{ scale: 1.15 }}
      whileTap={{ scale: 0.9 }}
      onClick={handleToggle}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      className={cn(
        'p-1.5 rounded-lg transition-colors',
        favorite ? 'text-amber-400 hover:bg-amber-500/10' : 'text-slate-500 hover:text-amber-400 hover:bg-white/5'
      )}
    >
      <Star className={cn('w-3.5 h-3.5', favorite && 'fill-amber-400')} />
    </motion.button>
  )
}
