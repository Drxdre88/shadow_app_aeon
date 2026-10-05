'use client'

import { Pin } from 'lucide-react'
import { motion } from 'framer-motion'
import type { FocusDominionView } from '@/lib/actions/dominion-focus'
import { cn } from '@/lib/utils/cn'
import { Chip, Dot, tint } from './brainUi'
import { WorkIcon, areaTone, lastActiveText, plural, scoreText, topWork } from './focusUi'

const STATE = {
  pinned: { label: 'Pinned', tone: 'var(--primary)' },
  dormant: { label: 'Dormant', tone: 'var(--text-dim)' },
  active: { label: 'Active', tone: 'var(--success)' },
} as const

function stateOf(d: FocusDominionView): keyof typeof STATE {
  if (d.pinned) return 'pinned'
  return d.dormant ? 'dormant' : 'active'
}

function breakdown(d: FocusDominionView): string | undefined {
  const a = d.activity
  if (!a) return undefined
  return `${plural(a.sessions, 'session')} · ${plural(a.cardsFinished, 'card')} finished · ${plural(a.notes, 'note')}`
}

interface Props {
  dominion: FocusDominionView
  topScore: number
  nowIso: string
  saving: boolean
  onTogglePin: () => void
}

export function FocusRow({ dominion: d, topScore, nowIso, saving, onTogglePin }: Props) {
  const state = STATE[stateOf(d)]
  const tone = areaTone(d.color)
  const share = topScore > 0 ? Math.max(2, Math.round((d.activityScore / topScore) * 100)) : 0
  const work = topWork(d.activity)
  const quiet = stateOf(d) === 'dormant'

  return (
    <div className={cn('flex items-start gap-3 px-5 py-3.5', quiet && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Dot tone={tone} />
          <span className="truncate text-[13px] font-semibold text-white" title={d.name}>{d.name}</span>
          <Chip tone={state.tone}>{state.label}</Chip>
        </div>

        <div className="mt-2 flex items-center gap-3" title={breakdown(d)}>
          <div
            className="h-1.5 flex-1 rounded-full bg-white/[0.05] overflow-hidden"
            role="meter"
            aria-label={`${d.name} activity`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={share}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: tint(tone, 70) }}
              initial={{ width: 0 }}
              animate={{ width: `${share}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          <span className="w-10 text-right text-[12px] font-medium tabular-nums text-white/75">{scoreText(d.activityScore)}</span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
          <span>{lastActiveText(d.lastActiveAt, nowIso)}</span>
          {work.map((item) => (
            <span key={item.key} className="inline-flex min-w-0 items-center gap-1 text-white/55">
              <span className="text-white/20" aria-hidden>·</span>
              <WorkIcon kind={item.kind} />
              <span className={cn('max-w-[11rem] truncate', item.kind === 'repo' && 'font-mono text-[10.5px]')} title={item.label}>
                {item.label}
              </span>
            </span>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onTogglePin}
        disabled={saving}
        aria-pressed={d.pinned}
        aria-label={d.pinned ? `Unpin ${d.name}` : `Pin ${d.name}`}
        title={d.pinned ? 'Pinned — stays awake however quiet it gets' : 'Pin to keep this area awake'}
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors outline-none',
          'focus-visible:ring-1 focus-visible:ring-[color:var(--primary)] disabled:opacity-60',
          !d.pinned && 'border-white/[0.08] text-white/35 hover:text-white/80 hover:bg-white/[0.05]',
        )}
        style={d.pinned ? { color: 'var(--primary)', background: tint('var(--primary)', 14), borderColor: tint('var(--primary)', 45) } : undefined}
      >
        <Pin className={cn('w-3.5 h-3.5', d.pinned && 'fill-current')} />
      </button>
    </div>
  )
}
