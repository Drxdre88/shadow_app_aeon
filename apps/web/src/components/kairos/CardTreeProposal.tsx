'use client'

import { GitBranch } from 'lucide-react'
import type { KairosInboxCardTree } from '@/lib/data/inbox'

// A card tree Vorath drafted from a goal: the cards, what each waits on, and
// Approve / Veto. Nothing exists on the board until the owner approves.

type Decision = { ok: true; verdict: 'approve' | 'veto' } | { ok: false; reason: string }

const FAILURE_TEXT: Record<string, string> = {
  already_decided: 'Already decided',
  expired: 'Expired — nothing was created',
  not_found: 'No longer in the inbox',
  forbidden_actor: 'You can no longer edit that board — nothing was created',
}

export function cardTreeDecisionText(decision: Decision): string {
  if (decision.ok) return decision.verdict === 'approve' ? 'Approved — cards created ✓' : 'Vetoed — nothing created ✓'
  return FAILURE_TEXT[decision.reason] ?? `Not decided (${decision.reason})`
}

function expiryText(expiresAt: string): string {
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })
}

export function CardTreeProposal({
  proposal,
  cardTree,
  working,
  decision,
  onDecide,
}: {
  proposal: { id: string; title: string }
  cardTree: KairosInboxCardTree
  working: boolean
  decision: Decision | undefined
  onDecide: (id: string, verdict: 'approve' | 'veto') => void
}) {
  const nameOf = new Map(cardTree.cards.map((c) => [c.key, c.name]))
  const expiry = expiryText(cardTree.expiresAt)
  return (
    <li className="rounded-xl bg-white/[0.04] border border-sky-300/15 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">{proposal.title}</h3>
        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-sky-400/10 text-sky-200/80 border border-sky-300/20">
          <GitBranch className="w-2.5 h-2.5" aria-hidden="true" /> Card tree
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[11px] leading-relaxed">
        <p className="text-white/70"><span className="text-white/30">Goal · </span>{cardTree.goal}</p>
        {cardTree.rationale && <p className="text-white/45">{cardTree.rationale}</p>}
        <ol className="mt-1 flex flex-col gap-1.5" aria-label={`${cardTree.cards.length} proposed cards`}>
          {cardTree.cards.map((card, i) => {
            const after = card.dependsOn.map((k) => nameOf.get(k)).filter(Boolean)
            return (
              <li key={card.key} className="rounded-lg bg-black/20 border border-white/[0.05] px-3 py-2">
                <p className="text-white/80">
                  <span className="mr-1.5 font-mono text-[10px] text-white/30">{i + 1}.</span>
                  {card.name}
                  {card.priority !== 'medium' && <span className="ml-1.5 text-[9px] uppercase tracking-[0.14em] text-amber-200/70">{card.priority}</span>}
                </p>
                {card.description && <p className="mt-0.5 text-white/40">{card.description}</p>}
                {(card.labels.length > 0 || card.checklist.length > 0 || after.length > 0) && (
                  <p className="mt-0.5 text-[10px] text-white/35">
                    {[
                      card.labels.length > 0 ? `Labels: ${card.labels.join(', ')}` : '',
                      card.checklist.length > 0 ? `${card.checklist.length} checklist ${card.checklist.length === 1 ? 'step' : 'steps'}` : '',
                      after.length > 0 ? `After: ${after.join(', ')}` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            )
          })}
        </ol>
        <p className="text-white/35">
          Approve to create {cardTree.cards.length === 1 ? 'this card' : `these ${cardTree.cards.length} cards`} on {cardTree.projectName || 'the board'}{expiry && ` · expires ${expiry}`}
        </p>
      </div>
      {decision ? (
        <p role="status" className={`mt-3 text-[10px] uppercase tracking-[0.16em] ${decision.ok ? 'text-emerald-200/80' : 'text-white/45'}`}>
          {cardTreeDecisionText(decision)}
        </p>
      ) : (
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
        </div>
      )}
    </li>
  )
}
