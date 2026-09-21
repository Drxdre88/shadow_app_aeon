'use client'

import { AlertTriangle, CheckCircle2, CircleHelp, GitBranch, ListChecks, PackageOpen, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { readMissionResult } from './autoRun'

const statusTone = {
  completed: {
    icon: CheckCircle2,
    label: 'Completed',
    classes: 'border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-300',
  },
  needs_input: {
    icon: CircleHelp,
    label: 'Needs input',
    classes: 'border-amber-400/25 bg-amber-500/[0.08] text-amber-200',
  },
  failed: {
    icon: XCircle,
    label: 'Failed',
    classes: 'border-rose-400/20 bg-rose-500/[0.06] text-rose-300',
  },
} as const

export function MissionResultSection({ result, label = 'Last recorded result' }: { result: unknown; label?: string }) {
  const parsed = readMissionResult(result)
  if (!parsed) return null

  const tone = parsed.status ? statusTone[parsed.status] : null
  const StatusIcon = tone?.icon ?? AlertTriangle
  const hasDetails = parsed.summary || parsed.branch || parsed.commit || parsed.artifacts.length > 0
    || parsed.tests || parsed.questions.length > 0 || parsed.recommendedTasks.length > 0

  return (
    <section aria-label={label} className="rounded-xl border border-white/[0.08] bg-black/20 overflow-hidden">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-white/[0.06]">
        <StatusIcon className={cn('w-4 h-4', tone ? '' : 'text-slate-400')} />
        <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400 shrink-0">{label}</span>
        {parsed.outcome && <span className="text-[10px] text-slate-500 capitalize truncate min-w-0">· {parsed.outcome.replaceAll('_', ' ')}</span>}
        <span className={cn('ml-auto px-2 py-0.5 rounded-full border text-[10px] font-medium shrink-0', tone?.classes ?? 'border-white/10 bg-white/5 text-slate-400')}>
          {tone?.label ?? 'Unrecognized result'}
        </span>
      </div>

      {!hasDetails ? (
        <p className="p-3 text-xs text-slate-500">The recorded result has no readable details.</p>
      ) : (
        <div className="p-3 space-y-3">
          {parsed.questions.length > 0 && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-500/[0.08] p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200 mb-2">
                <CircleHelp className="w-3.5 h-3.5" /> Input required
              </div>
              <ul className="space-y-1.5 text-sm text-amber-50/90">
                {parsed.questions.map((question, index) => <li key={`${question}-${index}`}>{question}</li>)}
              </ul>
            </div>
          )}

          {parsed.summary && <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">{parsed.summary}</p>}

          {(parsed.branch || parsed.commit) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {parsed.branch && (
                <span className="inline-flex items-center gap-1.5 text-slate-300">
                  <GitBranch className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-mono break-all">{parsed.branch}</span>
                </span>
              )}
              {parsed.commit && <span className="font-mono text-slate-400 break-all">commit {parsed.commit}</span>}
            </div>
          )}

          {parsed.tests && (
            <div className="flex items-start gap-2 text-xs text-slate-300">
              <ListChecks className="w-3.5 h-3.5 mt-0.5 text-slate-500" />
              <span>
                <span className="font-medium capitalize">Tests {parsed.tests.status.replace('_', ' ')}</span>
                {parsed.tests.summary ? ` — ${parsed.tests.summary}` : ''}
              </span>
            </div>
          )}

          {parsed.artifacts.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">
                <PackageOpen className="w-3 h-3" /> Artifacts
              </div>
              <ul className="space-y-1 text-xs font-mono text-slate-300">
                {parsed.artifacts.map((artifact, index) => <li key={`${artifact}-${index}`} className="break-all">{artifact}</li>)}
              </ul>
            </div>
          )}

          {parsed.recommendedTasks.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">Recommended follow-up</div>
              <ul className="space-y-2">
                {parsed.recommendedTasks.map((task, index) => (
                  <li key={`${task.title}-${index}`} className="rounded-lg bg-white/[0.04] border border-white/[0.06] px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white">{task.title}</span>
                      {task.objective && <span className="text-[9px] uppercase tracking-wider text-slate-500">{task.objective.replace('_', ' ')}</span>}
                    </div>
                    {task.instruction && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap break-words">{task.instruction}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
