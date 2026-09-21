'use client'

import { Bot, CircleHelp, Cpu, GitBranch, Rocket, Zap } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { readMissionCard } from './autoRun'

const objectiveLabel = (value: string | null) => value ? value.replace('_', ' ') : 'Needs setup'

export function MissionCardFace({ metadata }: { metadata?: Record<string, unknown> }) {
  const mission = readMissionCard(metadata)
  if (!mission) return null

  const resultStatus = mission.lastResult?.status
  const needsInput = resultStatus === 'needs_input'

  return (
    <section
      aria-label="Agent mission summary"
      className={cn(
        'mb-2 rounded-lg border overflow-hidden',
        needsInput
          ? 'border-amber-400/25 bg-amber-500/[0.07]'
          : 'border-[color-mix(in_srgb,var(--primary)_28%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]'
      )}
    >
      <div className="px-2 py-1.5 flex items-center gap-1.5 border-b border-white/[0.06]">
        <Bot className="w-3 h-3 text-[var(--primary)]" />
        <span className="text-[9px] uppercase tracking-[0.14em] font-semibold text-[var(--primary)]">Agent mission</span>
        {mission.autoRun && <Zap aria-label="Auto-run armed" className="ml-auto w-3 h-3 text-amber-300" />}
      </div>
      <div className="px-2 py-2 space-y-1.5">
        <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px]">
          <span className="text-slate-500">Repo</span>
          <span className={cn('font-mono truncate', mission.repo ? 'text-white/85' : 'text-amber-300')}>{mission.repo ?? 'Not selected'}</span>
          <span className="text-slate-500">Objective</span>
          <span className="capitalize text-slate-300">{objectiveLabel(mission.objective)}</span>
          <span className="text-slate-500">Agent</span>
          <span className="inline-flex items-center gap-1 text-slate-300 truncate">
            <Cpu className="w-2.5 h-2.5" />
            {mission.agent ?? 'Not selected'}{mission.model ? ` · ${mission.model}` : ''}
          </span>
        </div>
        {mission.instruction ? (
          <p className="text-[10px] leading-snug text-slate-300 line-clamp-2">{mission.instruction}</p>
        ) : (
          <p className="text-[10px] text-amber-300">Add an instruction before launch.</p>
        )}
        {mission.lastResult && (
          <div className={cn('pt-1.5 border-t border-white/[0.06] flex items-start gap-1.5 text-[10px]', needsInput ? 'text-amber-200' : 'text-slate-400')}>
            {needsInput ? <CircleHelp className="w-3 h-3 mt-px shrink-0" /> : <GitBranch className="w-3 h-3 mt-px shrink-0" />}
            <span className="line-clamp-2">
              <span className="font-medium">Last recorded result{resultStatus ? ` · ${resultStatus.replace('_', ' ')}` : ''}</span>
              {mission.lastResult.summary ? ` — ${mission.lastResult.summary}` : ''}
            </span>
          </div>
        )}
        {!mission.lastResult && mission.sessionIds.length > 0 && (
          <div className="pt-1.5 border-t border-white/[0.06] flex items-center gap-1.5 text-[10px] text-slate-500">
            <Rocket className="w-3 h-3" /> Run recorded · open card for current status
          </div>
        )}
      </div>
    </section>
  )
}
