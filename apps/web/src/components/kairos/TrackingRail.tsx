'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Pin, Activity, ChevronRight, ChevronLeft } from 'lucide-react'
import type { GraphNode } from '@/lib/data/memories'
import type { KairosTimeWindow } from '@/stores/kairosPrefsStore'

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1]
const RAIL_W = 260

const WINDOW_OPTIONS: { id: KairosTimeWindow; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: '30d', label: '30d' },
  { id: '7d', label: '7d' },
  { id: '1d', label: '1d' },
]

type Props = {
  nodes: GraphNode[]
  onSelect: (id: string) => void
  collapsed: boolean
  onToggle: () => void
  timeWindow: KairosTimeWindow
  onTimeWindow: (w: KairosTimeWindow) => void
  visibleCount: number
}

export function TrackingRail({ nodes, onSelect, collapsed, onToggle, timeWindow, onTimeWindow, visibleCount }: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const capturedToday = nodes.filter((n) => new Date(n.createdAt) >= today).length
  const eodDone = nodes.some(
    (n) => new Date(n.createdAt) >= today && (n.type === 'reflection' || (n.tags ?? []).includes('eod'))
  )
  const pinned = nodes.filter((n) => n.pinned).slice(0, 8)
  const recent = [...nodes]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)

  const streak = computeStreak(nodes)

  return (
    <>
      {/* Reopen handle — slim glowing tab at the right edge when collapsed. */}
      <AnimatePresence>
        {collapsed && (
          <motion.button
            key="rail-handle"
            onClick={onToggle}
            title="Show tracking rail"
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 14 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center h-16 w-6 rounded-l-xl border border-r-0 border-white/[0.10] bg-black/50 backdrop-blur-md text-white/45 hover:text-white/85 hover:bg-black/70 transition-colors"
            style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.45)' }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* The rail itself — animates its width so it reclaims canvas space as it
          slides away; the inner content holds a fixed width and is clipped. */}
      <motion.aside
        animate={{ width: collapsed ? 0 : RAIL_W }}
        transition={{ duration: 0.45, ease: EASE }}
        className="shrink-0 border-l border-white/[0.06] bg-black/30 backdrop-blur-md overflow-hidden"
      >
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1, filter: collapsed ? 'blur(8px)' : 'blur(0px)' }}
          transition={{ duration: collapsed ? 0.25 : 0.4, ease: EASE }}
          className="flex flex-col p-3 gap-4 overflow-y-auto h-full"
          style={{ width: RAIL_W }}
        >
          <div className="flex items-center justify-between -mb-1">
            <span className="text-[9px] uppercase tracking-[0.28em] text-white/30">Tracking</span>
            <button
              onClick={onToggle}
              title="Hide tracking rail"
              className="flex items-center justify-center w-6 h-6 rounded-md text-white/35 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <Section title="Lookback">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
          {WINDOW_OPTIONS.map((w) => (
            <button
              key={w.id}
              onClick={() => onTimeWindow(w.id)}
              className={`flex-1 px-1.5 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.14em] ${
                timeWindow === w.id
                  ? 'bg-white/[0.12] text-white/90'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-white/35">
          {visibleCount} of {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </div>
      </Section>

      <Section title="Today">
        <Stat label={`${capturedToday} capture${capturedToday === 1 ? '' : 's'}`} />
        <Stat label={eodDone ? 'EOD reflected ✓' : 'EOD pending'} muted={!eodDone} />
      </Section>

      <Section title="Streak">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-emerald-300" />
          <span className="text-[12px] font-semibold text-white/80">{streak} day{streak === 1 ? '' : 's'}</span>
        </div>
      </Section>

      <Section title={`Pinned (${pinned.length})`}>
        {pinned.length === 0 ? (
          <Empty>Nothing pinned yet</Empty>
        ) : (
          pinned.map((n) => (
            <RowButton key={n.id} onClick={() => onSelect(n.id)}>
              <Pin className="w-3 h-3 shrink-0 text-amber-300" />
              <span className="truncate">{n.title}</span>
            </RowButton>
          ))
        )}
      </Section>

      <Section title="Recent">
        {recent.length === 0 ? (
          <Empty>No memories yet</Empty>
        ) : (
          recent.map((n) => (
            <RowButton key={n.id} onClick={() => onSelect(n.id)}>
              <span className="text-[10px] text-white/30 shrink-0">{sourceIcon(n.source)}</span>
              <span className="truncate">{n.title}</span>
            </RowButton>
          ))
        )}
          </Section>
        </motion.div>
      </motion.aside>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[9px] uppercase tracking-[0.22em] text-white/40">{title}</div>
      {children}
    </div>
  )
}

function Stat({ label, muted }: { label: string; muted?: boolean }) {
  return <div className={`text-[12px] ${muted ? 'text-white/40' : 'text-white/80'}`}>{label}</div>
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] italic text-white/30">{children}</div>
}

function RowButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <motion.button
      whileHover={{ x: 2 }}
      onClick={onClick}
      className="flex items-center gap-1.5 w-full text-left text-[11px] text-white/70 hover:text-white py-1"
    >
      {children}
    </motion.button>
  )
}

function sourceIcon(source: string): string {
  switch (source) {
    case 'claude': return '🤖'
    case 'voice':  return '🎙️'
    case 'manual': return '⌨️'
    default:       return '·'
  }
}

function computeStreak(nodes: GraphNode[]): number {
  if (nodes.length === 0) return 0
  const days = new Set<string>()
  for (const n of nodes) days.add(new Date(n.createdAt).toISOString().slice(0, 10))
  let streak = 0
  const cursor = new Date()
  while (true) {
    const key = cursor.toISOString().slice(0, 10)
    if (!days.has(key)) break
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
