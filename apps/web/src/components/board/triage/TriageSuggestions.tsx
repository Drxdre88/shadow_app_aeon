'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, Flag, Loader2, Sparkles, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { toast } from '@/components/ui/Toast'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { usePinnedCardsStore } from '@/lib/store/pinnedCardsStore'
import { useThemeStore } from '@/stores/themeStore'
import { resolveCardTriage } from '@/lib/actions/card-triage'
import type { CardTriage, TriageDecision, TriagePriority } from '@/lib/kairos/triage/types'
import { triageRows, type TriageRowView } from './triage-view'

interface TriageSuggestionsProps {
  taskId: string
  projectId: string
  /** Keeps the open card form in step when a priority suggestion is accepted. */
  onPriorityAccepted?: (priority: TriagePriority) => void
}

const ICONS = { label: Tag, priority: Flag, duplicate: Copy } as const

// Mirror a decided suggestion into the board store without marking it dirty:
// the server already holds it.
function mirror(taskId: string, triage: CardTriage, row: TriageRowView, decision: TriageDecision) {
  useBoardStore.setState((state) => ({
    tasks: state.tasks.map((t): BoardTask => {
      if (t.id !== taskId) return t
      const next: BoardTask = { ...t, metadata: { ...t.metadata, triage } }
      if (decision !== 'accept') return next
      if (row.kind === 'label' && !t.labels.includes(row.ref)) next.labels = [...t.labels, row.ref]
      if (row.kind === 'priority') next.priority = row.ref as BoardTask['priority']
      return next
    }),
  }))
}

/** The compact "Vorath suggests" block on a card: Accept or Dismiss each suggestion. */
export function TriageSuggestions({ taskId, projectId, onPriorityAccepted }: TriageSuggestionsProps) {
  const tasks = useBoardStore((s) => s.tasks)
  const labels = useBoardStore((s) => s.labels)
  const priorities = useThemeStore((s) => s.priorities)
  const [busy, setBusy] = useState<string | null>(null)

  const card = tasks.find((t) => t.id === taskId)
  const rows = useMemo(() => {
    if (!card) return []
    const taskNames = new Map(tasks.map((t) => [t.id, t.name]))
    return triageRows(card, { labels, priorities, taskNames })
  }, [card, tasks, labels, priorities])

  if (rows.length === 0) return null

  const decide = async (row: TriageRowView, decision: TriageDecision) => {
    if (busy) return
    setBusy(row.key)
    try {
      const { triage } = await resolveCardTriage(projectId, taskId, { kind: row.kind, ref: row.ref, decision })
      mirror(taskId, triage, row, decision)
      if (decision === 'accept' && row.kind === 'priority') onPriorityAccepted?.(row.ref as TriagePriority)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save that — please try again')
    } finally {
      setBusy(null)
    }
  }

  const open = (row: TriageRowView) => usePinnedCardsStore.getState().openCard(row.ref)

  return (
    <section
      aria-label="Vorath suggests"
      className="rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/[0.06] p-3 space-y-2"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]">
        <Sparkles className="w-3.5 h-3.5" />
        Vorath suggests
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => {
          const Icon = ICONS[row.kind]
          const isBusy = busy === row.key
          return (
            <li key={row.key} className="flex items-start gap-2 text-xs">
              <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: row.color ?? 'var(--text-muted)' }} />
              <div className="flex-1 min-w-0">
                <div className="text-white break-words">{row.title}</div>
                <div className="text-[var(--text-muted)] break-words">{row.reason}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {row.kind === 'duplicate' && row.openable && (
                  <TriageButton label="Open the other card" onClick={() => open(row)}>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </TriageButton>
                )}
                {!row.accepted && (
                  <>
                    <TriageButton
                      label={row.kind === 'duplicate' ? 'Yes, same work' : 'Accept'}
                      disabled={busy !== null}
                      onClick={() => decide(row, 'accept')}
                      tone="accept"
                    >
                      {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </TriageButton>
                    <TriageButton label="Dismiss" disabled={busy !== null} onClick={() => decide(row, 'dismiss')}>
                      <X className="w-3.5 h-3.5" />
                    </TriageButton>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TriageButton({ label, onClick, disabled, tone, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'accept'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'p-1 rounded-md border transition-colors disabled:opacity-50',
        tone === 'accept'
          ? 'border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/15'
          : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/10'
      )}
    >
      {children}
    </button>
  )
}
