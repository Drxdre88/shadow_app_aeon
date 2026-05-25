'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bot, Calendar, ChevronRight, FileDown, Webhook, Server, Sparkles } from 'lucide-react'
import { getTodaysAutoCaptures } from '@/lib/actions/memories'

// ─────────────────────────────────────────────────────────────────────────
// Notes polish — "Today's auto-captures" strip.
//
// Surfaces what Kairos has been logging on the operator's behalf today
// (board events, session summaries, advisories, snapshots) so the user
// can see the system's working state without scrolling.
// ─────────────────────────────────────────────────────────────────────────

type AutoCapture = Awaited<ReturnType<typeof getTodaysAutoCaptures>>[number]

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  claude:  Bot,
  cron:    Calendar,
  system:  Server,
  webhook: Webhook,
  hook:    FileDown,
}

const TYPE_TINT: Record<string, string> = {
  advisory:        'var(--primary)',
  session_summary: '#a78bfa',
  achievement:     '#34d399',
  snapshot:        '#60a5fa',
  session_event:   '#fbbf24',
  reflection:      '#fb7185',
}

type Props = {
  onOpen: (id: string) => void
}

export function TodaysAutoCaptures({ onOpen }: Props) {
  const [rows, setRows] = useState<AutoCapture[] | null>(null)

  useEffect(() => {
    getTodaysAutoCaptures({ limit: 30 })
      .then((r) => setRows(r))
      .catch(() => setRows([]))
  }, [])

  if (rows === null) return null
  if (rows.length === 0) return null

  return (
    <motion.section
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="px-4 pt-3 pb-2 border-b border-white/[0.04]"
    >
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-3 h-3" style={{ color: 'var(--primary)' }} />
        <span className="text-[10px] uppercase tracking-[0.22em] text-white/55">
          Today, by Kairos
        </span>
        <span className="text-[10px] text-white/25">{rows.length} auto-captured</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-1 px-1 [scrollbar-width:thin]">
        {rows.map((r) => (
          <Chip key={r.id} row={r} onClick={() => onOpen(r.id)} />
        ))}
      </div>
    </motion.section>
  )
}

function Chip({ row, onClick }: { row: AutoCapture; onClick: () => void }) {
  const Icon = SOURCE_ICONS[row.source] ?? FileDown
  const tint = TYPE_TINT[row.type] ?? 'var(--primary)'
  const title = row.aiTitle?.trim() || row.title
  const when = relativeShort(new Date(row.createdAt))

  return (
    <motion.button
      whileHover={{ y: -1 }}
      onClick={onClick}
      className="group shrink-0 w-[200px] sm:w-[220px] text-left rounded-xl border border-white/[0.05] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all p-2.5"
      style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03)` }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded-md"
          style={{
            background: `color-mix(in oklab, ${tint} 18%, transparent)`,
            color: `color-mix(in oklab, ${tint} 35%, white)`,
          }}
        >
          <Icon className="w-2.5 h-2.5" />
        </span>
        <span
          className="text-[9px] uppercase tracking-[0.16em] font-medium"
          style={{ color: `color-mix(in oklab, ${tint} 50%, white)` }}
        >
          {row.type.replace(/_/g, ' ')}
        </span>
        <span className="ml-auto text-[9px] text-white/35">{when}</span>
      </div>
      <div className="text-[11.5px] text-white/85 leading-snug line-clamp-2 group-hover:text-white">
        {title}
      </div>
      {row.dominionName && (
        <div className="mt-1.5 flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: `var(--${row.dominionColor ?? 'primary'}, var(--primary))` }}
          />
          <span className="text-[9.5px] text-white/45 truncate">{row.dominionName}</span>
        </div>
      )}
      <ChevronRight className="w-3 h-3 text-white/0 group-hover:text-white/30 transition-colors absolute" style={{ visibility: 'hidden' }} />
    </motion.button>
  )
}

function relativeShort(d: Date): string {
  const diff = Date.now() - d.getTime()
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
