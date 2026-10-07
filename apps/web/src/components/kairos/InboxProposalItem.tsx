'use client'

import { Lightbulb } from 'lucide-react'
import { CardGardenProposal } from './CardGardenProposal'
import { CardTreeProposal } from './CardTreeProposal'
import { GoalCard } from './GoalProposalCard'
import { VoiceNoteCard } from './VoiceNoteCard'
import type { GoalDecision, GoalVerdict, ProposalItem, VoiceNoteItem } from './inbox-types'

// An idea-tournament survivor (docs/kairos/35) carries its card fields on the
// proposal item as `idea`. Read defensively: absent or malformed → a plain proposal.
export interface InboxIdeaCard {
  claim: string
  why: string | null
  nextStep: string | null
  survivedBecause: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function readInboxIdea(value: unknown): InboxIdeaCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const claim = text(v.claim)
  if (!claim) return null
  return { claim, why: text(v.why), nextStep: text(v.nextStep), survivedBecause: text(v.survivedBecause) }
}

function IdeaDetails({ idea }: { idea: InboxIdeaCard }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 text-[11px] leading-relaxed">
      <p className="text-white/70">{idea.claim}</p>
      {idea.why && <p className="text-white/45"><span className="text-white/30">Why · </span><span>{idea.why}</span></p>}
      {idea.nextStep && <p className="text-white/45"><span className="text-white/30">Next step · </span><span>{idea.nextStep}</span></p>}
      {idea.survivedBecause && (
        <p className="text-amber-100/60 italic">Survived because {idea.survivedBecause}</p>
      )}
    </div>
  )
}

export type InboxProposalEntry = VoiceNoteItem | ProposalItem

export type InboxProposalShape =
  | { kind: 'voice_note'; note: VoiceNoteItem }
  | { kind: 'goal'; proposal: ProposalItem; goal: NonNullable<ProposalItem['goal']> }
  | { kind: 'card_tree'; proposal: ProposalItem; cardTree: NonNullable<ProposalItem['cardTree']> }
  | { kind: 'card_garden'; proposal: ProposalItem; cardGarden: NonNullable<ProposalItem['cardGarden']> }
  | { kind: 'proposal'; proposal: ProposalItem }

// First match wins: a goal outranks a card tree, a card tree a card garden
// suggestion, and anything else is a plain (or idea) proposal.
export function classifyInboxProposal(item: InboxProposalEntry): InboxProposalShape {
  if (item.kind === 'voice_note') return { kind: 'voice_note', note: item }
  if (item.goal) return { kind: 'goal', proposal: item, goal: item.goal }
  if (item.cardTree) return { kind: 'card_tree', proposal: item, cardTree: item.cardTree }
  if (item.cardGarden) return { kind: 'card_garden', proposal: item, cardGarden: item.cardGarden }
  return { kind: 'proposal', proposal: item }
}

export interface InboxProposalItemProps {
  item: InboxProposalEntry
  working: boolean
  decision: GoalDecision | undefined
  onResolveVoiceNote: (noteId: string, resolution: 'confirm' | 'discard') => void
  onDecide: (id: string, verdict: GoalVerdict, reason?: string) => void
  onResolve: (id: string, resolution: 'accept' | 'dismiss') => void
}

export function InboxProposalItem({ item, working, decision, onResolveVoiceNote, onDecide, onResolve }: InboxProposalItemProps) {
  const shape = classifyInboxProposal(item)
  switch (shape.kind) {
    case 'voice_note':
      return <VoiceNoteCard note={shape.note} working={working} onResolve={onResolveVoiceNote} />
    case 'goal':
      return <GoalCard proposal={shape.proposal} goal={shape.goal} working={working} decision={decision} onDecide={onDecide} />
    case 'card_tree':
      return <CardTreeProposal proposal={shape.proposal} cardTree={shape.cardTree} working={working} decision={decision} onDecide={onDecide} />
    case 'card_garden':
      return <CardGardenProposal proposal={shape.proposal} cardGarden={shape.cardGarden} working={working} decision={decision} onDecide={onDecide} />
    case 'proposal':
      return <PlainProposalCard proposal={shape.proposal} working={working} onResolve={onResolve} />
    default: {
      const unhandled: never = shape
      return unhandled
    }
  }
}

function PlainProposalCard({ proposal, working, onResolve }: { proposal: ProposalItem; working: boolean; onResolve: InboxProposalItemProps['onResolve'] }) {
  const idea = 'idea' in proposal ? readInboxIdea(proposal.idea) : null
  return (
    <li className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">{proposal.title}</h3>
        {idea && (
          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-amber-400/10 text-amber-200/80 border border-amber-300/20">
            <Lightbulb className="w-2.5 h-2.5" aria-hidden="true" /> Idea
          </span>
        )}
      </div>
      {idea ? (
        <IdeaDetails idea={idea} />
      ) : proposal.summary && proposal.summary !== proposal.title && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{proposal.summary}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve(proposal.id, 'accept')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
        >
          {working ? 'Working…' : 'Accept'}
        </button>
        <button
          type="button"
          onClick={() => onResolve(proposal.id, 'dismiss')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
        >
          Dismiss
        </button>
      </div>
    </li>
  )
}
