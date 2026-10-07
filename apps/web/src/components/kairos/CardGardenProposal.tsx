'use client'

import Link from 'next/link'
import { Sprout } from 'lucide-react'
import type { KairosInboxCardGarden } from '@/lib/data/inbox'
import { cardGardenEffect } from '@/lib/kairos/card-garden/render'

// One weekly card garden suggestion: the card, its board, the action and why,
// with Approve / Veto. A merge only ever points at the board, where the owner
// fuses the two cards themselves.

type Decision = { ok: true; verdict: 'approve' | 'veto' } | { ok: false; reason: string }

const ACTION_LABEL: Record<KairosInboxCardGarden['action'], string> = { finish: 'Finish', park: 'Park', merge: 'Merge', kill: 'Kill' }

const FAILURE_TEXT: Record<string, string> = {
  already_decided: 'Already decided',
  expired: 'Expired — nothing changed',
  not_found: 'No longer in the inbox',
  forbidden_actor: 'You can no longer edit that board — nothing changed',
}

function approvedText(garden: Pick<KairosInboxCardGarden, 'action' | 'parkColumn' | 'doneColumn'>): string {
  switch (garden.action) {
    case 'finish':
      return garden.doneColumn ? `Approved — marked done and moved to ${garden.doneColumn} ✓` : 'Approved — marked done ✓'
    case 'park':
      return garden.parkColumn ? `Approved — moved to ${garden.parkColumn} ✓` : 'Approved — no backlog column, nothing moved'
    case 'merge':
      return 'Approved — fuse the cards on the board'
    case 'kill':
      return 'Approved — archived ✓'
  }
}

export function cardGardenDecisionText(decision: Decision, garden: Pick<KairosInboxCardGarden, 'action' | 'parkColumn' | 'doneColumn'>): string {
  if (decision.ok) return decision.verdict === 'approve' ? approvedText(garden) : 'Vetoed — nothing changed ✓'
  return FAILURE_TEXT[decision.reason] ?? `Not decided (${decision.reason})`
}

export function CardGardenProposal({
  proposal,
  cardGarden,
  working,
  decision,
  onDecide,
}: {
  proposal: { id: string; title: string }
  cardGarden: KairosInboxCardGarden
  working: boolean
  decision: Decision | undefined
  onDecide: (id: string, verdict: 'approve' | 'veto') => void
}) {
  const where = [cardGarden.projectName || 'Board', cardGarden.columnName].filter(Boolean).join(' · ')
  const boardHref = `/project/${cardGarden.projectId}`
  return (
    <li className="rounded-xl bg-white/[0.04] border border-lime-300/15 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">{cardGarden.taskName}</h3>
        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-lime-400/10 text-lime-200/80 border border-lime-300/20">
          <Sprout className="w-2.5 h-2.5" aria-hidden="true" /> {ACTION_LABEL[cardGarden.action]}
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1.5 text-[11px] leading-relaxed">
        <p className="text-white/45">
          {where} · untouched {cardGarden.ageDays} {cardGarden.ageDays === 1 ? 'day' : 'days'}
        </p>
        {cardGarden.action === 'merge' && cardGarden.mergeWith && (
          <p className="text-white/70"><span className="text-white/30">Merge with · </span>{cardGarden.mergeWith.name}</p>
        )}
        {cardGarden.reason && <p className="text-white/60">{cardGarden.reason}</p>}
        <p className="text-white/35">{cardGardenEffect(cardGarden)}</p>
        {cardGarden.action === 'merge' && (
          <Link href={boardHref} className="self-start text-sky-200/80 underline underline-offset-2 hover:text-sky-100">
            Open the board to fuse them
          </Link>
        )}
      </div>
      {decision ? (
        <p role="status" className={`mt-3 text-[10px] uppercase tracking-[0.16em] ${decision.ok ? 'text-emerald-200/80' : 'text-white/45'}`}>
          {cardGardenDecisionText(decision, cardGarden)}
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
