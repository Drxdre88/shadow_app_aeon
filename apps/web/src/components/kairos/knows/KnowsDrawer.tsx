'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { BookOpenCheck, X } from 'lucide-react'
import { MIND_NAME } from '@/lib/kairos/identity'
import { KnowsList } from './KnowsList'
import { NeedsEyesList } from './NeedsEyesList'
import { SensitiveToggle } from './SensitiveToggle'
import { useKnowsStore, type KnowsTab } from './knowsStore'

const TABS: { id: KnowsTab; label: string }[] = [
  { id: 'knows', label: `What ${MIND_NAME} knows` },
  { id: 'eyes', label: 'Needs your eyes' },
]

// Header entry point on the Vorath page.
export function KnowsButton() {
  const open = useKnowsStore((s) => s.open)
  const toggle = useKnowsStore((s) => s.toggle)
  return (
    <button
      onClick={toggle}
      title={`What ${MIND_NAME} knows about you`}
      aria-label={`What ${MIND_NAME} knows about you`}
      aria-pressed={open}
      className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors ${
        open ? 'text-white/90 bg-white/[0.10]' : 'text-white/40 hover:text-white/85 hover:bg-white/[0.06]'
      }`}
    >
      <BookOpenCheck className="w-3.5 h-3.5" />
    </button>
  )
}

// Left-side drawer over the galaxy; the memory panel stays on the right, so
// picking a row opens its "why" alongside the list.
export function KnowsDrawer({ onSelect }: { onSelect: (id: string) => void }) {
  const open = useKnowsStore((s) => s.open)
  const setOpen = useKnowsStore((s) => s.setOpen)
  const tab = useKnowsStore((s) => s.tab)
  const setTab = useKnowsStore((s) => s.setTab)

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="knows"
          initial={{ x: -380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -380, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          aria-label={`What ${MIND_NAME} knows`}
          className="absolute top-0 left-0 h-full w-[380px] z-20 bg-[rgba(10,10,15,0.94)] backdrop-blur-xl border-r border-white/[0.08] flex flex-col"
        >
          <div className="flex items-center gap-1 px-3 py-2.5 border-b border-white/[0.06]">
            <div role="tablist" className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.16em] ${
                    tab === t.id ? 'bg-white/[0.12] text-white/90' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="ml-auto p-1 text-white/40 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pt-3 text-[10.5px] text-white/40 leading-snug">
            {tab === 'knows'
              ? 'What I currently believe about you, by area. Open one to see why, or to fix it.'
              : 'New things I\u2019m not sure about yet. Confirm what\u2019s right; remove what isn\u2019t.'}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tab === 'knows' ? <KnowsList onSelect={onSelect} /> : <NeedsEyesList onSelect={onSelect} />}
          </div>
          <SensitiveToggle />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
