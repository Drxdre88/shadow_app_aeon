'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSidebarStore } from '@/stores/sidebarStore'
import { useFavoritesStore, deriveFavoritesList } from '@/stores/favoritesStore'
import { getFavoriteProjects } from '@/lib/actions/projects'

// Sidebar Favorites group — the user's starred boards across all realms,
// rendered ABOVE the realm/dominion groupings. Hydrates the shared
// favoritesStore once per page load; live-updates when a star is toggled
// anywhere (board header, dashboard) because those toggles patch the same
// store. Hidden entirely when there are no favorites to show.
export function SidebarFavorites({ collapsed, className }: { collapsed: boolean; className?: string }) {
  const entries = useFavoritesStore((s) => s.entries)
  const hiddenProjectIds = useSidebarStore((s) => s.hiddenProjectIds)
  const toggleHideProject = useSidebarStore((s) => s.toggleHideProject)
  const pathname = usePathname()
  const router = useRouter()
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    getFavoriteProjects()
      .then((rows) => useFavoritesStore.getState().setEntries(rows))
      .catch(() => {})
  }, [])

  const favorites = deriveFavoritesList(entries, hiddenProjectIds)
  if (favorites.length === 0) return null

  return (
    <div className={cn('flex flex-col gap-0.5 mb-2', collapsed && 'items-center', className)}>
      {!collapsed && (
        <span className="flex items-center gap-1.5 px-2 py-1">
          <Star className="w-3 h-3 fill-amber-400 text-amber-400" style={{ opacity: 0.7 }} />
          <span className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--primary)', opacity: 0.5 }}>
            Favorites
          </span>
        </span>
      )}

      <ul className={cn('flex flex-col gap-0.5', collapsed && 'items-center')}>
        {favorites.map((fav) => {
          const isActive = pathname?.startsWith(`/project/${fav.id}`) ?? false
          return (
            // `group`/`relative` live on the LI, not the button: the hide
            // toggle is a sibling of the nav button (a button inside a button
            // is invalid HTML and reads as one control to assistive tech), so
            // it is positioned over the row and shares the row's hover group.
            <li key={fav.id} className={cn('group relative', !collapsed && 'w-full')}>
              <motion.button
                whileTap={{ scale: 0.97 }}
                title={fav.name}
                onMouseEnter={() => router.prefetch(`/project/${fav.id}`)}
                onClick={() => router.push(`/project/${fav.id}`)}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-lg overflow-hidden',
                  'text-left text-xs font-medium transition-all duration-200',
                  collapsed ? 'justify-center w-9 h-9 px-0' : 'w-full pl-2 pr-7 py-1.5',
                  isActive
                    ? 'bg-white/[0.08] text-white'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]',
                  !collapsed && (isActive ? 'translate-x-1' : 'hover:translate-x-0.5'),
                )}
                style={
                  collapsed
                    ? undefined
                    : isActive
                      ? { borderLeft: '3px solid var(--primary)' }
                      : { borderLeft: '3px solid transparent' }
                }
              >
                <span
                  className={cn(
                    'absolute inset-0 opacity-0 group-hover:opacity-100 pointer-events-none',
                    'before:absolute before:inset-0 before:translate-x-[-100%] before:group-hover:translate-x-[100%]',
                    'before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent',
                    'before:transition-transform before:duration-500 before:ease-in-out'
                  )}
                />
                <span
                  className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center ring-1 ring-white/10 relative"
                  style={{
                    background: isActive
                      ? 'color-mix(in srgb, var(--primary) 25%, transparent)'
                      : 'rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <span className={cn('text-[8px] font-medium', isActive ? 'text-white' : 'text-white/50')}>
                    {fav.name.charAt(0)}
                  </span>
                </span>

                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex-1 truncate min-w-0 relative"
                    >
                      {fav.name}
                    </motion.span>
                  )}
                </AnimatePresence>

              </motion.button>

              {!collapsed && (
                <button
                  type="button"
                  title="Hide from sidebar"
                  aria-label={`Hide ${fav.name} from sidebar`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded hover:bg-white/[0.1] text-white/40 hover:text-white/70 transition-all"
                  onClick={() => toggleHideProject(fav.id)}
                >
                  <EyeOff className="w-3 h-3" />
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <div
        className="mt-1.5 mx-1 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, var(--primary), transparent)', opacity: 0.2 }}
      />
    </div>
  )
}
