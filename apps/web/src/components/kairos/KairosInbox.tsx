'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Check, ChevronDown, Inbox, Lightbulb, MessageCircleQuestion, Mic, Sparkles, Target, X } from 'lucide-react'
import {
  acceptKairosInboxProposal,
  answerKairosInboxAsk,
  decideKairosInboxProposal,
  dismissKairosInboxAsk,
  dismissKairosInboxProposal,
  listKairosInbox,
} from '@/lib/actions/kairos-inbox'
import { confirmVoiceNote, discardVoiceNote } from '@/lib/actions/kairos-voice'
import { InboxExtras } from './inbox-extras'

type InboxData = Awaited<ReturnType<typeof listKairosInbox>>
type InboxItem = InboxData['items'][number]
type VoiceNoteItem = Extract<InboxItem, { kind: 'voice_note' }>
type ProposalItem = Extract<InboxItem, { kind: 'proposal' }>
type GoalVerdict = 'approve' | 'veto'
type GoalDecision = Awaited<ReturnType<typeof decideKairosInboxProposal>>

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
function GoalCard({
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

// One card per voice note: confirm or discard every pending part at once.
function VoiceNoteCard({
  note,
  working,
  onResolve,
}: {
  note: VoiceNoteItem
  working: boolean
  onResolve: (noteId: string, resolution: 'confirm' | 'discard') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const waiting = note.segments.length
  return (
    <li className="rounded-xl bg-white/[0.04] border border-violet-300/15 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">
          <Mic className="inline w-3 h-3 mr-1.5 -mt-0.5 text-violet-200/75" aria-hidden="true" />
          {note.parts > 1 ? `Voice note · ${note.parts} parts` : 'Voice note'}
        </h3>
        {waiting < note.parts && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-white/[0.05] text-white/45 border border-white/[0.08]">
            {waiting} of {note.parts} waiting
          </span>
        )}
      </div>
      {note.summary && <p className="mt-1.5 text-[11px] leading-relaxed text-white/60 italic">“{note.summary}”</p>}
      {waiting > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-white/40 hover:text-white/70"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          {expanded ? 'Hide parts' : `Show ${waiting} parts`}
        </button>
      )}
      {expanded && (
        <ol className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-white/50">
          {note.segments.map((segment) => (
            <li key={segment.id}>
              <span className="mr-1.5 font-mono text-[10px] text-white/30">{segment.voiceNote?.part ?? '·'}</span>
              {segment.summary ?? segment.title}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve(note.id, 'confirm')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
        >
          {working ? 'Working…' : 'Confirm all'}
        </button>
        <button
          type="button"
          onClick={() => onResolve(note.id, 'discard')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
        >
          Discard
        </button>
      </div>
    </li>
  )
}

export function KairosInbox() {
  const [data, setData] = useState<InboxData>({ items: [] })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [workingId, setWorkingId] = useState<string | null>(null)
  const [goalDecisions, setGoalDecisions] = useState<Record<string, GoalDecision>>({})
  const [mounted, setMounted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listKairosInbox())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    load()
  }, [load])

  useEffect(() => {
    if (!open) return
    load()
    const poll = window.setInterval(load, 60_000)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, load])

  const asks = useMemo(() => data.items.filter((i): i is Extract<InboxItem, { kind: 'ask' }> => i.kind === 'ask'), [data.items])
  const notifies = useMemo(() => data.items.filter((i): i is Extract<InboxItem, { kind: 'notify' }> => i.kind === 'notify'), [data.items])
  // Proposals and grouped voice notes, in inbox order.
  const proposals = useMemo(() => data.items.filter((i): i is Extract<InboxItem, { kind: 'proposal' | 'voice_note' }> => i.kind === 'proposal' || i.kind === 'voice_note'), [data.items])

  const count = asks.length + notifies.length + proposals.length

  const dropAnswer = (askId: string) => setAnswers((prev) => {
    const next = { ...prev }
    delete next[askId]
    return next
  })

  const submitAnswer = async (askId: string) => {
    const answer = answers[askId] ?? ''
    if (!answer.trim()) return
    setWorkingId(askId)
    setError(null)
    try {
      await answerKairosInboxAsk(askId, answer)
      dropAnswer(askId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to answer Kairos')
    } finally {
      setWorkingId(null)
    }
  }

  const dismissAsk = async (askId: string) => {
    setWorkingId(askId)
    setError(null)
    try {
      await dismissKairosInboxAsk(askId)
      dropAnswer(askId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss question')
    } finally {
      setWorkingId(null)
    }
  }

  const resolveVoiceNote = async (noteId: string, resolution: 'confirm' | 'discard') => {
    setWorkingId(noteId)
    setError(null)
    try {
      if (resolution === 'confirm') await confirmVoiceNote(noteId)
      else await discardVoiceNote(noteId)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${resolution} voice note`)
    } finally {
      setWorkingId(null)
    }
  }

  // No reload here: the card keeps showing the outcome until the next poll.
  const decideGoal = async (id: string, verdict: GoalVerdict, reason?: string) => {
    setWorkingId(id)
    setError(null)
    try {
      const decision = await decideKairosInboxProposal(id, verdict, reason || undefined)
      setGoalDecisions((prev) => ({ ...prev, [id]: decision }))
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${verdict} goal`)
    } finally {
      setWorkingId(null)
    }
  }

  const resolveItem = async (id: string, resolution: 'accept' | 'dismiss') => {
    setWorkingId(id)
    setError(null)
    try {
      if (resolution === 'accept') await acceptKairosInboxProposal(id)
      else await dismissKairosInboxProposal(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${resolution} item`)
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Kairos inbox${count ? `, ${count} pending` : ''}`}
        title="Kairos inbox"
        className="relative flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] text-white/40 hover:text-white/85 hover:bg-white/[0.08] transition-colors"
      >
        <Bell className="w-3.5 h-3.5" />
        {count > 0 && (
          <span
            className="absolute -right-1.5 -top-1.5 min-w-4 h-4 px-1 rounded-full text-[9px] leading-4 font-semibold text-white"
            style={{
              backgroundColor: 'var(--primary)',
              boxShadow: '0 0 10px color-mix(in srgb, var(--primary) 65%, transparent)',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.button
                type="button"
                aria-label="Close Kairos inbox"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[180] bg-black/45 backdrop-blur-[2px]"
                onClick={() => setOpen(false)}
              />
              <motion.aside
                role="dialog"
                aria-modal="true"
                aria-labelledby="kairos-inbox-title"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 280, damping: 32 }}
                className="fixed right-0 top-0 bottom-0 z-[181] w-full sm:w-[440px] bg-[rgba(8,6,18,0.96)] backdrop-blur-xl border-l border-white/[0.06] shadow-2xl flex flex-col"
              >
                <header className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-violet-300" />
                    <div>
                      <h2 id="kairos-inbox-title" className="text-[10px] uppercase tracking-[0.22em] text-white/80">
                        Kairos inbox
                      </h2>
                      <p className="text-[10px] text-white/35 mt-0.5">What Kairos wants your attention on</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close Kairos inbox"
                    className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </header>

                {error && (
                  <div className="px-5 py-2 text-[11px] text-rose-300 border-b border-rose-500/20 bg-rose-500/[0.06]">
                    {error}
                  </div>
                )}

                <div className="flex-1 overflow-y-auto px-5 py-5">
                  <InboxExtras ownerModelEnabled={data.ownerModelEnabled === true} />
                  {loading && count === 0 ? (
                    <div className="text-[12px] text-white/40">Loading…</div>
                  ) : count === 0 ? (
                    <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-4 py-8 text-center">
                      <Check className="w-5 h-5 text-emerald-300/80 mx-auto mb-2" />
                      <p className="text-[12px] text-white/65">Nothing needs your attention.</p>
                      <p className="text-[10px] text-white/30 mt-1">Kairos will surface asks and proposals here.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      {asks.length > 0 && (
                        <section>
                          <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.2em] text-violet-200/70">
                            <MessageCircleQuestion className="w-3 h-3" /> Open questions · {asks.length}
                          </div>
                          <ul className="flex flex-col gap-2">
                            {asks.map((ask) => {
                              const working = workingId === ask.id
                              const answer = answers[ask.id] ?? ''
                              return (
                                <li key={ask.id} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
                                  <p className="text-[13px] leading-relaxed text-white/85">
                                    <span className="mr-1.5 font-mono text-[11px] text-violet-200/70">Q{ask.seq}</span>
                                    {ask.title}
                                  </p>
                                  <textarea
                                    value={answer}
                                    onChange={(event) => {
                                      const value = event.target.value
                                      setAnswers((prev) => ({ ...prev, [ask.id]: value }))
                                    }}
                                    rows={3}
                                    maxLength={10_000}
                                    aria-label={`Answer Q${ask.seq}`}
                                    placeholder="Answer Kairos…"
                                    className="mt-3 w-full resize-none rounded-lg bg-black/20 border border-white/[0.08] px-3 py-2 text-[12px] leading-relaxed text-white/85 placeholder:text-white/30 outline-none focus:border-violet-400/35"
                                  />
                                  <div className="mt-2 flex justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() => dismissAsk(ask.id)}
                                      disabled={working}
                                      aria-label={`Dismiss Q${ask.seq}`}
                                      className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
                                    >
                                      Dismiss
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => submitAnswer(ask.id)}
                                      disabled={!answer.trim() || working}
                                      className="px-3 py-1.5 rounded-md border text-[10px] uppercase tracking-[0.16em] text-white hover:brightness-125 disabled:opacity-35 disabled:cursor-not-allowed"
                                      style={{
                                        backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                                        borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
                                      }}
                                    >
                                      {working ? 'Sending…' : 'Send answer'}
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )}

                      {notifies.length > 0 && (
                        <section>
                          <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                            <Bell className="w-3 h-3" /> Kairos says · {notifies.length}
                          </div>
                          <ul className="flex flex-col gap-2">
                            {notifies.map((notify) => {
                              const working = workingId === notify.id
                              return (
                                <li
                                  key={notify.id}
                                  className={notify.daily
                                    ? 'rounded-xl border border-amber-300/20 bg-gradient-to-br from-amber-400/[0.08] to-violet-500/[0.05] p-4'
                                    : 'rounded-xl bg-white/[0.04] border border-white/[0.06] p-4'}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <h3 className={`text-[12px] font-medium ${notify.daily ? 'text-amber-100/90' : 'text-white/85'}`}>
                                      {notify.daily && <Sparkles className="inline w-3 h-3 mr-1.5 -mt-0.5 text-amber-200/75" />}
                                      {notify.title}
                                    </h3>
                                    {notify.urgency !== 'normal' && (
                                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] ${
                                        notify.urgency === 'high'
                                          ? 'bg-rose-500/15 text-rose-200 border border-rose-400/20'
                                          : 'bg-white/[0.05] text-white/40 border border-white/[0.08]'
                                      }`}>
                                        {notify.urgency}
                                      </span>
                                    )}
                                  </div>
                                  {notify.summary && notify.summary !== notify.title && (
                                    <p className="mt-1.5 text-[11px] leading-relaxed text-white/45 whitespace-pre-wrap">{notify.summary}</p>
                                  )}
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => resolveItem(notify.id, 'dismiss')}
                                      disabled={working}
                                      className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
                                    >
                                      {working ? 'Working…' : 'Dismiss'}
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )}

                      {proposals.length > 0 && (
                        <section>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Inbound proposals · {proposals.length}
                          </div>
                          <ul className="flex flex-col gap-2">
                            {proposals.map((proposal) => {
                              if (proposal.kind === 'voice_note') {
                                return (
                                  <VoiceNoteCard
                                    key={proposal.id}
                                    note={proposal}
                                    working={workingId === proposal.id}
                                    onResolve={resolveVoiceNote}
                                  />
                                )
                              }
                              const working = workingId === proposal.id
                              if (proposal.goal) {
                                return (
                                  <GoalCard
                                    key={proposal.id}
                                    proposal={proposal}
                                    goal={proposal.goal}
                                    working={working}
                                    decision={goalDecisions[proposal.id]}
                                    onDecide={decideGoal}
                                  />
                                )
                              }
                              const idea = 'idea' in proposal ? readInboxIdea(proposal.idea) : null
                              return (
                                <li key={proposal.id} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
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
                                      onClick={() => resolveItem(proposal.id, 'accept')}
                                      disabled={working}
                                      className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
                                    >
                                      {working ? 'Working…' : 'Accept'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => resolveItem(proposal.id, 'dismiss')}
                                      disabled={working}
                                      className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
                                    >
                                      Dismiss
                                    </button>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        </section>
                      )}
                    </div>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
