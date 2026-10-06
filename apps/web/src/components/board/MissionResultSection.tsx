'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, GitBranch, ListChecks, PackageOpen, ShieldCheck, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { VERDICT_LABELS, readVisibleMissionCheck, type MissionCheck } from '@/lib/kairos/mission-check/types'
import { readMissionResult } from './autoRun'
import { MissionAnswerForm } from './MissionAnswerForm'
import { MissionFollowUpPicker } from './MissionFollowUpPicker'

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

export interface MissionResultActions {
  projectId: string
  taskId: string
  /** Offer answer boxes for the agent's questions. */
  canAnswer?: boolean
  /** Offer "Create mission cards" for the recommended follow-ups. */
  canCreateFollowUps?: boolean
  createdFollowUps?: string[]
}

const verdictTone = {
  looks_done: 'border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-300',
  partly_done: 'border-amber-400/25 bg-amber-500/[0.08] text-amber-200',
  not_done: 'border-rose-400/20 bg-rose-500/[0.06] text-rose-300',
} as const

/** Vorath's advisory verdict on the latest mission; reasons and unmet items fold out. */
function MissionCheckVerdict({ check }: { check: MissionCheck }) {
  const [open, setOpen] = useState(false)
  const hasMore = check.reasons.length > 0 || check.unmet.length > 0 || Boolean(check.note)
  return (
    <div className="px-3 py-2.5 border-t border-white/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasMore}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left disabled:cursor-default"
      >
        <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="text-xs text-slate-300">Vorath&apos;s check:</span>
        <span className={cn('px-2 py-0.5 rounded-full border text-[10px] font-medium', verdictTone[check.verdict])}>
          {VERDICT_LABELS[check.verdict]}
        </span>
        {hasMore && <ChevronDown className={cn('ml-auto w-3.5 h-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {check.note && <p className="text-slate-300">{check.note}</p>}
          {check.reasons.length > 0 && (
            <ul className="list-disc pl-4 space-y-1 text-slate-400">
              {check.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
            </ul>
          )}
          {check.unmet.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1">Looks unmet</div>
              <ul className="list-disc pl-4 space-y-1 text-amber-100/80">
                {check.unmet.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-slate-500">Advisory — based on what the mission reported; you decide.</p>
    </div>
  )
}

export function MissionResultSection({ result, label = 'Last recorded result', actions, mission }: {
  result: unknown
  label?: string
  actions?: MissionResultActions
  /** The card's raw hangar metadata; Vorath's check is shown only when switched fully on and about the latest mission. */
  mission?: unknown
}) {
  const parsed = readMissionResult(result)
  const check = readVisibleMissionCheck(mission)
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
          {parsed.questions.length > 0 && actions?.canAnswer && (
            <MissionAnswerForm
              key={parsed.questions.join('\n')}
              projectId={actions.projectId}
              taskId={actions.taskId}
              questions={parsed.questions}
            />
          )}

          {parsed.questions.length > 0 && !actions?.canAnswer && (
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

          {parsed.recommendedTasks.length > 0 && actions?.canCreateFollowUps && (
            <MissionFollowUpPicker
              key={parsed.recommendedTasks.map((task) => task.title).join('\n')}
              projectId={actions.projectId}
              taskId={actions.taskId}
              tasks={parsed.recommendedTasks}
              alreadyCreated={actions.createdFollowUps}
            />
          )}

          {parsed.recommendedTasks.length > 0 && !actions?.canCreateFollowUps && (
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

      {check && <MissionCheckVerdict key={check.checkedAt} check={check} />}
    </section>
  )
}
