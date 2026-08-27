'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Trophy, ArrowRight, Link2, Tag, Trash2, Plus, ChevronDown, Pencil, Archive, type LucideIcon } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'
import type { ActivityEvent } from '@/lib/db/schema'

interface TrophyTimelineProps {
  projectId: string
  events: ActivityEvent[]
  onLoadMore: () => void
  hasMore: boolean
  isLoading: boolean
}

// Gold marks the celebratory moments; everything else stays neutral.
const actionDotStyles: Record<string, { dot: string; ring?: boolean; icon: LucideIcon }> = {
  created: { dot: 'bg-emerald-500', icon: Plus },
  completed: { dot: 'bg-amber-500', ring: true, icon: Trophy },
  moved: { dot: 'bg-slate-500', icon: ArrowRight },
  deleted: { dot: 'bg-red-500', icon: Trash2 },
  dependency_added: { dot: 'bg-slate-500', icon: Link2 },
  dependency_removed: { dot: 'bg-slate-500', icon: Link2 },
  label_added: { dot: 'bg-slate-500', icon: Tag },
  label_removed: { dot: 'bg-slate-500', icon: Tag },
  updated: { dot: 'bg-slate-500', icon: Pencil },
  vaulted: { dot: 'bg-amber-400', ring: true, icon: Archive },
}

function buildEventDescription(event: ActivityEvent): string {
  const meta = (event.metadata ?? {}) as Record<string, string>
  const name = event.entityName ?? 'item'

  switch (event.action) {
    case 'created':
      return `Created ${name}`
    case 'completed':
      return `Completed ${name}`
    case 'moved': {
      const from = meta.fromColumn
      const to = meta.toColumn
      if (from && to) return `Moved ${name} from ${from} to ${to}`
      return `Moved ${name}`
    }
    case 'deleted':
      return `Deleted ${name}`
    case 'dependency_added':
      return `Added dependency on ${meta.blockerName ?? name}`
    case 'dependency_removed':
      return `Removed dependency on ${meta.blockerName ?? name}`
    case 'label_added':
      return `Added label ${meta.labelName ?? name}`
    case 'label_removed':
      return `Removed label ${meta.labelName ?? name}`
    case 'updated':
      return `Updated ${name}`
    case 'vaulted':
      return `Vaulted ${name}`
    default:
      return `${event.action} ${name}`
  }
}

const eventVariants = {
  hidden: { opacity: 0, x: -12 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 280, damping: 24 } },
}

export function TrophyTimeline({ events, onLoadMore, hasMore, isLoading }: TrophyTimelineProps) {
  const { glowIntensity } = useThemeStore()
  const mult = glowIntensity / 75

  return (
    <div className="backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex flex-col h-full">
      <div className="flex items-center gap-2 mb-4">
        <Trophy className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Activity Timeline</h3>
        <span className="ml-auto text-xs text-slate-500">{events.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0 relative min-h-0">
        {events.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500 text-sm">
            <Trophy className="w-8 h-8 mb-2 opacity-30" />
            No activity yet
          </div>
        )}

        <AnimatePresence initial={false}>
          {events.map((event, idx) => {
            const actionStyle = actionDotStyles[event.action] ?? actionDotStyles.updated
            const DotIcon = actionStyle.icon
            const isLast = idx === events.length - 1
            const description = buildEventDescription(event)
            const relativeTime = formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })

            return (
              <motion.div
                key={event.id}
                variants={eventVariants}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, x: -8 }}
                className="flex gap-3 relative"
              >
                <div className="flex flex-col items-center flex-shrink-0">
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 z-10',
                      actionStyle.dot
                    )}
                    style={
                      actionStyle.ring && glowIntensity > 0
                        ? { boxShadow: `0 0 ${10 * mult}px ${3 * mult}px rgba(245,158,11,0.5)` }
                        : undefined
                    }
                  >
                    <DotIcon className="w-3 h-3 text-white" />
                  </div>
                  {!isLast && (
                    <div className="w-px flex-1 bg-white/[0.08] mt-1 mb-1" />
                  )}
                </div>

                <div className={cn('pb-4 flex-1 min-w-0', isLast && 'pb-1')}>
                  <p className="text-xs text-slate-300 leading-snug">{description}</p>
                  <span className="text-[10px] text-slate-600 mt-0.5 block">{relativeTime}</span>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 rounded-full border-2 border-amber-500/30 border-t-amber-400 animate-spin" />
          </div>
        )}
      </div>

      {hasMore && !isLoading && (
        <button
          onClick={onLoadMore}
          className={cn(
            'mt-3 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg',
            'text-xs text-slate-400 border border-white/[0.08]',
            'bg-white/[0.03] hover:bg-white/[0.06] hover:text-slate-300',
            'transition-all duration-200'
          )}
        >
          <ChevronDown className="w-3.5 h-3.5" />
          Load more
        </button>
      )}
    </div>
  )
}
