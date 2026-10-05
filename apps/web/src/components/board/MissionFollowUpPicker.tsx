'use client'

import { useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils/cn'
import { loadHangarActions } from './MissionAutopilotPanel'

interface FollowUp {
  title: string
  objective: string | null
  instruction: string | null
}

/** Pick recommended follow-ups and turn them into new mission cards linked to this one. */
export function MissionFollowUpPicker({
  projectId,
  taskId,
  tasks,
  alreadyCreated = [],
}: {
  projectId: string
  taskId: string
  tasks: FollowUp[]
  alreadyCreated?: string[]
}) {
  const [created, setCreated] = useState<Set<string>>(() => new Set(alreadyCreated))
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)

  const toggle = (index: number) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })

  const submit = async () => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      const indexes = [...selected].sort((a, b) => a - b)
      const cards = await (await loadHangarActions()).createFollowUpCards(projectId, taskId, indexes)
      setCreated((current) => new Set([...current, ...indexes.map((index) => tasks[index].title)]))
      setSelected(new Set())
      toast(cards.length === 1 ? 'Created 1 mission card' : `Created ${cards.length} mission cards`)
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the mission cards')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">Recommended follow-up</div>
      <ul className="space-y-2">
        {tasks.map((task, index) => {
          const done = created.has(task.title)
          return (
            <li key={`${task.title}-${index}`} className={cn('rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2', done && 'opacity-60')}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--primary)]"
                  checked={selected.has(index)}
                  disabled={done || busy}
                  onChange={() => toggle(index)}
                  aria-label={`Select follow-up: ${task.title}`}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">{task.title}</span>
                    {task.objective && <span className="text-[9px] uppercase tracking-wider text-slate-500">{task.objective.replace('_', ' ')}</span>}
                    {done && <span className="text-[9px] uppercase tracking-wider text-emerald-300">Card created</span>}
                  </span>
                  {task.instruction && <span className="block text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words">{task.instruction}</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={submit}
        disabled={busy || selected.size === 0}
        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create mission cards
      </button>
    </div>
  )
}
