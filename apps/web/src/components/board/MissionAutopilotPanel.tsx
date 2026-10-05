'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, PencilLine, RotateCcw, WifiOff } from 'lucide-react'
import { toast } from '@/components/ui/Toast'
import { useBoardStore } from '@/lib/store/boardStore'
import { withConfirmedMissionLaunch } from './autoRun'

const RELAUNCHABLE = new Set(['timeout', 'failed', 'killed'])

// Loaded on click so the card modal's module graph stays free of the Hangar
// server actions until an autopilot control is actually used.
export const loadHangarActions = () => import('@/lib/actions/hangar')

/** Reflect a server-confirmed launch on the board so the card starts polling the new run. */
export function recordLocalLaunch(taskId: string, sessionId: string) {
  useBoardStore.setState((state) => ({
    tasks: withConfirmedMissionLaunch(state.tasks, taskId, sessionId, new Date().toISOString()),
  }))
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function readPlanGateStatus(mission: Record<string, unknown> | null): string | null {
  const gate = readRecord(mission?.planGate)
  return typeof gate?.status === 'string' ? gate.status : null
}

const buttonClass = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
const primaryStyle = {
  backgroundColor: 'color-mix(in srgb, var(--primary) 18%, transparent)',
  borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)',
  color: 'var(--primary)',
}

/**
 * Autopilot controls on a mission card: runner-offline notice, Requeue for a
 * stopped run, and the plan approval gate (Approve plan & build / Revise).
 */
export function MissionAutopilotPanel({
  projectId,
  taskId,
  mission,
  latestSession,
}: {
  projectId: string
  taskId: string
  mission: Record<string, unknown>
  latestSession: { id: string; status: string } | null
}) {
  const [busy, setBusy] = useState<'requeue' | 'approve' | 'revise' | null>(null)
  const [revising, setRevising] = useState(false)
  const [note, setNote] = useState('')

  const stall = readRecord(mission.stall)
  const runnerOffline = stall?.kind === 'runner_offline' && latestSession?.status === 'queued' && stall.sessionId === latestSession.id
  const canRequeue = latestSession !== null && RELAUNCHABLE.has(latestSession.status)
  const live = latestSession?.status === 'queued' || latestSession?.status === 'running'
  const planWaiting = !live && readPlanGateStatus(mission) === 'awaiting_approval'

  if (!runnerOffline && !canRequeue && !planWaiting) return null

  const run = async (kind: 'requeue' | 'approve' | 'revise', action: () => Promise<{ id: string }>, done: string) => {
    setBusy(kind)
    try {
      const session = await action()
      recordLocalLaunch(taskId, session.id)
      toast(done)
      setRevising(false)
      setNote('')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not relaunch the mission')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      {runnerOffline && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2.5 text-xs text-amber-200">
          <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Runner offline — no runner has picked this mission up for {String(stall?.minutes ?? 30)} minutes. It stays queued and starts when a runner comes back.
        </p>
      )}

      {canRequeue && !planWaiting && (
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <span className="text-xs text-slate-400">The last run stopped ({latestSession?.status}). Run the same mission again?</span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run('requeue', async () => (await loadHangarActions()).requeueMission(projectId, taskId), 'Mission requeued — the runner will pick it up shortly')}
            className={`ml-auto ${buttonClass}`}
            style={primaryStyle}
          >
            {busy === 'requeue' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Requeue
          </button>
        </div>
      )}

      {planWaiting && (
        <div className="rounded-lg border border-[var(--primary)]/25 bg-[var(--primary)]/[0.05] px-3 py-2.5 space-y-2">
          <p className="text-xs text-slate-300">
            The agent wrote a plan in the <strong className="text-white">Plan</strong> checklist. Edit it if needed, then approve it to start the build.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('approve', async () => (await loadHangarActions()).approvePlanAndBuild(projectId, taskId), 'Plan approved — the build mission is queued')}
              className={buttonClass}
              style={primaryStyle}
            >
              {busy === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Approve plan &amp; build
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setRevising((open) => !open)}
              className={`${buttonClass} border-white/10 bg-white/5 text-slate-300 hover:bg-white/10`}
              aria-expanded={revising}
            >
              <PencilLine className="w-3 h-3" /> Revise
            </button>
          </div>
          {revising && (
            <div className="space-y-2">
              <textarea
                aria-label="What should change in the plan?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What should change in the plan?"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1] text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50"
              />
              <button
                type="button"
                disabled={busy !== null || note.trim().length === 0}
                onClick={() => run('revise', async () => (await loadHangarActions()).revisePlan(projectId, taskId, note.trim()), 'Plan sent back for revision')}
                className={buttonClass}
                style={primaryStyle}
              >
                {busy === 'revise' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Send revision
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
