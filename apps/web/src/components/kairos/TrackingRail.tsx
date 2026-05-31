'use client'

import { motion } from 'framer-motion'
import { Pin, Activity } from 'lucide-react'
import type { GraphNode } from '@/lib/data/memories'

type Props = {
  nodes: GraphNode[]
  onSelect: (id: string) => void
}

export function TrackingRail({ nodes, onSelect }: Props) {
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
    <aside className="w-[260px] shrink-0 border-l border-white/[0.06] bg-black/30 backdrop-blur-md flex flex-col p-3 gap-4 overflow-y-auto">
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
    </aside>
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
