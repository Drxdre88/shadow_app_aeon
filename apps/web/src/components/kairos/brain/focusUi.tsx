'use client'

import { GitBranch, LayoutGrid, RefreshCw } from 'lucide-react'
import type { FocusDominionView } from '@/lib/actions/dominion-focus'
import type { UnattributedActivity } from '@/lib/kairos/living/types'
import { Panel, tint } from './brainUi'

export type WorkItem = { key: string; kind: 'board' | 'repo'; label: string; score: number }

// Dominion colours are theme keys ("purple", "sky"…); unknown keys fall back to the theme primary.
export function areaTone(color: string): string {
  return /^[a-z][a-z0-9-]*$/.test(color) ? `var(--${color}, var(--primary))` : 'var(--primary)'
}

export function lastActiveText(lastActiveAt: string | null, nowIso: string): string {
  if (!lastActiveAt) return 'No activity seen yet'
  const days = Math.floor((Date.parse(nowIso) - Date.parse(lastActiveAt)) / 86_400_000)
  if (days <= 0) return 'Last active today'
  if (days === 1) return 'Last active yesterday'
  return `Last active ${days} days ago`
}

export function topWork(activity: FocusDominionView['activity'] | UnattributedActivity | null, limit = 3): WorkItem[] {
  if (!activity) return []
  const items: WorkItem[] = [
    ...activity.boards.map((b) => ({ key: `b:${b.id}`, kind: 'board' as const, label: b.name, score: b.score })),
    ...activity.repos.map((r) => ({ key: `r:${r.slug}`, kind: 'repo' as const, label: r.slug, score: r.score })),
  ]
  return items.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function scoreText(score: number): string {
  return score >= 10 ? String(Math.round(score)) : score.toFixed(1)
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function WorkIcon({ kind }: { kind: WorkItem['kind'] }) {
  const Icon = kind === 'repo' ? GitBranch : LayoutGrid
  return <Icon className="w-3 h-3 shrink-0 text-white/35" aria-hidden />
}

export function UnattributedList({ unattributed }: { unattributed: UnattributedActivity }) {
  const items = topWork(unattributed, Number.POSITIVE_INFINITY)
  if (items.length === 0) return null
  return (
    <Panel className="divide-y divide-white/[0.06]">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2.5 px-3.5 py-2">
          <WorkIcon kind={item.kind} />
          <span
            className={item.kind === 'repo' ? 'min-w-0 flex-1 truncate font-mono text-[11.5px] text-white/80' : 'min-w-0 flex-1 truncate text-[12px] text-white/80'}
            title={item.label}
          >
            {item.label}
          </span>
          <span className="text-[10.5px] text-white/35">{item.kind === 'repo' ? 'Repo' : 'Board'}</span>
          <span className="w-10 text-right text-[11.5px] tabular-nums text-white/60">{scoreText(item.score)}</span>
        </div>
      ))}
    </Panel>
  )
}

export function FocusErrorStrip({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2 text-[11.5px]"
      style={{ borderColor: tint('var(--error)', 30), background: tint('var(--error)', 6) }}
    >
      <span className="text-white/70">{message}</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium hover:brightness-125" style={{ color: 'var(--error)' }}>
        <RefreshCw className="w-3 h-3" /> Reload
      </button>
    </div>
  )
}

export function FocusEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-5 text-[12px] text-white/45">{children}</div>
  )
}

export function FocusSkeleton() {
  return (
    <div className="divide-y divide-white/[0.06]" aria-busy="true" aria-label="Loading where your time went">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-white/[0.10] animate-pulse" />
            <span className="h-3 w-32 rounded bg-white/[0.08] animate-pulse" />
          </div>
          <span className="h-1 w-3/4 rounded bg-white/[0.06] animate-pulse" />
        </div>
      ))}
    </div>
  )
}
