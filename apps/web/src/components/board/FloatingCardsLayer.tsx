'use client'

import { useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useBoardStore } from '@/lib/store/boardStore'
import { usePinnedCardsStore } from '@/lib/store/pinnedCardsStore'
import { resolveAccentHex } from '@/lib/utils/colors'
import { FloatingCardWindow, type FloatingCardCallbacks } from './FloatingCardWindow'

interface FloatingCardsLayerProps extends FloatingCardCallbacks {
  projectId: string
  /** Return a card to the normal centered-modal flow. */
  onUnpin: (taskId: string) => void
}

/**
 * Renders every pinned card for this board as a floating window plus a
 * bottom dock of folded-away chips. The layer itself is pointer-events-none
 * — there is deliberately NO backdrop, so the board underneath keeps full
 * interactivity (scroll, drag & drop, opening more cards).
 */
export function FloatingCardsLayer({
  projectId,
  onUnpin,
  ...callbacks
}: FloatingCardsLayerProps) {
  const cards = usePinnedCardsStore((s) => s.cards)
  const closeCard = usePinnedCardsStore((s) => s.closeCard)
  const setFolded = usePinnedCardsStore((s) => s.setFolded)
  const tasks = useBoardStore((s) => s.tasks)

  // Drop windows whose task disappeared (deleted, or the board switched
  // projects and reloaded the task set).
  useEffect(() => {
    for (const card of cards) {
      if (!tasks.some((t) => t.id === card.taskId)) closeCard(card.taskId)
    }
  }, [cards, tasks, closeCard])

  const projectCards = useMemo(
    () =>
      cards.filter((card) =>
        tasks.some((t) => t.id === card.taskId && t.projectId === projectId)
      ),
    [cards, tasks, projectId]
  )

  if (projectCards.length === 0) return null

  const openCards = projectCards.filter((c) => !c.folded)
  const foldedCards = projectCards.filter((c) => c.folded)

  return (
    <div
      className="fixed inset-0 z-40 pointer-events-none"
      data-floating-cards-layer
    >
      {openCards.map((card) => (
        <FloatingCardWindow
          key={card.taskId}
          card={card}
          projectId={projectId}
          onUnpin={onUnpin}
          {...callbacks}
        />
      ))}

      {foldedCards.length > 0 && (
        <div
          className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-wrap justify-center gap-2 max-w-[92vw]"
          data-floating-cards-dock
        >
          {foldedCards.map((card) => {
            const task = tasks.find((t) => t.id === card.taskId)
            const name = task?.name || 'Untitled card'
            const colorHex = resolveAccentHex(task?.color)
            return (
              <div
                key={card.taskId}
                className={cn(
                  'flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-full',
                  'bg-black/70 backdrop-blur-md border border-white/15',
                  'shadow-[0_4px_16px_rgba(0,0,0,0.4)]'
                )}
              >
                <button
                  onClick={() => setFolded(card.taskId, false)}
                  title={`Restore ${name}`}
                  className="flex items-center gap-2 min-w-0 text-xs text-slate-200 hover:text-white transition-colors"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colorHex, boxShadow: `0 0 6px ${colorHex}80` }}
                  />
                  <span className="truncate max-w-[10rem]">{name}</span>
                </button>
                <button
                  onClick={() => closeCard(card.taskId)}
                  title="Close pinned card"
                  aria-label={`Close pinned card ${name}`}
                  className="p-0.5 rounded-full text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
