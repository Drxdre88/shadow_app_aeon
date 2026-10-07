'use client'

import { useState } from 'react'
import { Target } from 'lucide-react'
import type { GoalDecision, GoalVerdict, ProposalItem } from './inbox-types'

export const GOAL_VETO_REASON_MAX = 2000

const GOAL_FAILURE_TEXT: Record<string, string> = {
  already_decided: 'Already decided',
  already_resolved: 'Already decided',
  expired: 'Expired — no action',
  not_found: 'No longer in the inbox',
  cap_reached: 'Two goals are already open — not approved',
}

export function goalDecisionText(decision: GoalDecision): string {
  if (decision.ok) return decision.verdict === 'approve' ? 'Approved ✓' : 'Vetoed ✓'
  return GOAL_FAILURE_TEXT[decision.reason] ?? `Not decided (${decision.reason})`
}

function goalExpiry(expiresAt: string): string {
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

// Kairos's own goal proposal: Approve, Veto, or Veto + why. No answer = no
// action (it expires). The decision's outcome stays on the card until the
// next inbox refresh drops it.
export function GoalCard({
  proposal,
  goal,
  working,
  decision,
  onDecide,
}: {
  proposal: ProposalItem
  goal: NonNullable<ProposalItem['goal']>
  working: boolean
  decision: GoalDecision | undefined
  onDecide: (id: string, verdict: GoalVerdict, reason?: string) => void
}) {
  const [askingWhy, setAskingWhy] = useState(false)
  const [reason, setReason] = useState('')
  const expiry = goalExpiry(goal.expiresAt)
  return (
    <li className="rounded-xl bg-white/[0.04] border border-violet-300/15 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">{proposal.title}</h3>
        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-violet-400/10 text-violet-200/80 border border-violet-300/20">
          <Target className="w-2.5 h-2.5" aria-hidden="true" /> Goal
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[11px] leading-relaxed">
        <p className="text-white/70">{goal.question}</p>
        {goal.why && <p className="text-white/45"><span className="text-white/30">Why · </span><span>{goal.why}</span></p>}
        {goal.successCheck && <p className="text-white/45"><span className="text-white/30">Success check · </span><span>{goal.successCheck}</span></p>}
        <p className="text-white/35">
          Due {goal.dueInDays} {goal.dueInDays === 1 ? 'day' : 'days'} after you approve{expiry && ` · expires ${expiry}`}
        </p>
      </div>
      {decision ? (
        <p role="status" className={`mt-3 text-[10px] uppercase tracking-[0.16em] ${decision.ok ? 'text-emerald-200/80' : 'text-white/45'}`}>
          {goalDecisionText(decision)}
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onDecide(proposal.id, 'approve')}
              disabled={working}
              className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
            >
              {working ? 'Working…' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => onDecide(proposal.id, 'veto')}
              disabled={working}
              className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
            >
              Veto
            </button>
            <button
              type="button"
              onClick={() => setAskingWhy((v) => !v)}
              disabled={working}
              aria-expanded={askingWhy}
              className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
            >
              Veto + why
            </button>
          </div>
          {askingWhy && (
            <>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                maxLength={GOAL_VETO_REASON_MAX}
                aria-label={`Why veto ${proposal.title}`}
                placeholder="Why not this goal?"
                className="mt-3 w-full resize-none rounded-lg bg-black/20 border border-white/[0.08] px-3 py-2 text-[12px] leading-relaxed text-white/85 placeholder:text-white/30 outline-none focus:border-violet-400/35"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDecide(proposal.id, 'veto', reason.trim())}
                  disabled={!reason.trim() || working}
                  className="px-3 py-1.5 rounded-md border text-[10px] uppercase tracking-[0.16em] text-white hover:brightness-125 disabled:opacity-35 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
                  }}
                >
                  {working ? 'Sending…' : 'Send veto'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </li>
  )
}
