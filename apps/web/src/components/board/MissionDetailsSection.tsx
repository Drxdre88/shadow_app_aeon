'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Bot, Cpu, Loader2, Pencil, Radio, Rocket, Zap } from 'lucide-react'
import { getMissionSessionStatusAction } from '@/lib/actions/sessions'
import { cn } from '@/lib/utils/cn'
import { readHangarMission, readMissionCard } from './autoRun'
import { MissionResultSection } from './MissionResultSection'

const LIVE_STATUSES = new Set(['queued', 'running'])

interface MissionSessionStatus {
  id: string
  projectId: string | null
  taskId: string | null
  status: string
}

function formatObjective(value: string | null) {
  return value ? value.replace('_', ' ') : 'Needs setup'
}

export function MissionDetailsSection({
  taskId,
  projectId,
  metadata,
  onConfigure,
}: {
  taskId: string
  projectId: string
  metadata?: Record<string, unknown>
  onConfigure?: () => void
}) {
  const mission = readMissionCard(metadata)
  const rawMission = readHangarMission(metadata)
  const [latestSession, setLatestSession] = useState<MissionSessionStatus | null>(null)
  const [sessionState, setSessionState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [instructionExpanded, setInstructionExpanded] = useState(false)

  useEffect(() => {
    if (!mission) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    setLatestSession(null)
    setSessionState('loading')
    const sessionId = mission.sessionIds.at(-1)
    if (!sessionId) {
      setSessionState('ready')
      return
    }
    const load = async () => {
      try {
        const session = await getMissionSessionStatusAction({ sessionId, projectId, taskId }) as MissionSessionStatus
        if (cancelled) return
        if (session.taskId !== taskId || session.projectId !== projectId) {
          setSessionState('error')
          return
        }
        setLatestSession(session)
        setSessionState('ready')
        if (LIVE_STATUSES.has(session.status)) timer = setTimeout(load, 4000)
      } catch {
        if (!cancelled) setSessionState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [metadata, projectId, taskId])

  if (!mission || !rawMission) return null

  const live = latestSession ? LIVE_STATUSES.has(latestSession.status) : false
  const resultLabel = live ? 'Previous recorded result' : 'Last recorded result'
  const instructionLong = (mission.instruction?.length ?? 0) > 280
  const instruction = mission.instruction && instructionLong && !instructionExpanded
    ? `${mission.instruction.slice(0, 280).trimEnd()}…`
    : mission.instruction

  return (
    <section aria-label="Agent mission details" className="rounded-2xl border border-[var(--primary)]/20 bg-[var(--primary)]/[0.04] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2 border-b border-white/[0.08]">
        <Bot className="w-4 h-4 text-[var(--primary)]" />
        <div>
          <div className="text-sm font-semibold text-white">Agent mission</div>
          <div className="text-[10px] text-slate-500">Execution context and delivery record</div>
        </div>
        {onConfigure && (
          <button
            type="button"
            onClick={onConfigure}
            className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Pencil className="w-3 h-3" /> Configure / launch
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <dl className="grid grid-cols-2 gap-3">
          <MissionField label="Repository" value={mission.repo ?? 'Not selected'} mono missing={!mission.repo} />
          <MissionField label="Objective" value={formatObjective(mission.objective)} missing={!mission.objective} />
          <MissionField label="Agent" value={mission.agent ?? 'Not selected'} missing={!mission.agent} icon={<Cpu className="w-3 h-3" />} />
          <MissionField label="Model" value={mission.model ?? 'Runner default'} mono />
          <MissionField
            label="Launch mode"
            value={mission.autoRun ? 'Auto-run on drop' : 'Manual launch'}
            icon={mission.autoRun ? <Zap className="w-3 h-3 text-amber-300" /> : <Rocket className="w-3 h-3" />}
          />
        </dl>

        <div className="rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2.5 flex items-center gap-2 text-xs">
          {sessionState === 'loading' ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin text-slate-500" /><span className="text-slate-500">Checking latest run…</span></>
          ) : sessionState === 'error' ? (
            <><Radio className="w-3.5 h-3.5 text-slate-500" /><span className="text-slate-500">Current run status unavailable.</span></>
          ) : latestSession ? (
            <>
              <Radio className={cn('w-3.5 h-3.5', live ? 'text-emerald-400 animate-pulse' : 'text-slate-500')} />
              <span className="text-slate-500">Latest run</span>
              <span className={cn('font-medium capitalize', live ? 'text-emerald-300' : latestSession.status === 'failed' || latestSession.status === 'killed' || latestSession.status === 'timeout' ? 'text-rose-300' : 'text-slate-200')}>
                {latestSession.status}
              </span>
              <span className="ml-auto font-mono text-[10px] text-slate-600 truncate">{latestSession.id}</span>
            </>
          ) : (
            <><Radio className="w-3.5 h-3.5 text-slate-600" /><span className="text-slate-500">No run recorded for this mission.</span></>
          )}
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">Instruction</div>
          {instruction ? (
            <div className="rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2.5">
              <p className="text-sm leading-relaxed text-slate-200 whitespace-pre-wrap break-words">{instruction}</p>
              {instructionLong && (
                <button
                  type="button"
                  onClick={() => setInstructionExpanded((expanded) => !expanded)}
                  className="mt-2 text-xs font-medium text-[var(--primary)] hover:text-white transition-colors"
                >
                  {instructionExpanded ? 'Collapse instruction' : 'Show full instruction'}
                </button>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2.5 text-sm text-amber-200">
              Add an instruction before this mission can launch.
            </p>
          )}
        </div>

        <MissionResultSection result={rawMission.lastResult} label={resultLabel} />
      </div>
    </section>
  )
}

function MissionField({ label, value, mono = false, missing = false, icon }: { label: string; value: string; mono?: boolean; missing?: boolean; icon?: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500 mb-1">{label}</dt>
      <dd className={cn('text-xs capitalize flex items-center gap-1.5 break-words', mono && 'font-mono normal-case', missing ? 'text-amber-300' : 'text-slate-200')}>
        {icon}{value}
      </dd>
    </div>
  )
}
