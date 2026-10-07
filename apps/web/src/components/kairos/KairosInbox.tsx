'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Check, Inbox, MessageCircleQuestion, Sparkles, X } from 'lucide-react'
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
import { InboxProposalItem } from './InboxProposalItem'
import type { GoalDecision, GoalVerdict, InboxData, InboxItem } from './inbox-types'

export { readInboxIdea, type InboxIdeaCard } from './InboxProposalItem'
export { GOAL_VETO_REASON_MAX, goalDecisionText } from './GoalProposalCard'

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
      setError(err instanceof Error ? err.message : 'Failed to answer Vorath')
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
        aria-label={`Vorath inbox${count ? `, ${count} pending` : ''}`}
        title="Vorath inbox"
        className="relative flex items-center gap-1.5 h-7 px-2 rounded-md bg-white/[0.04] border border-white/[0.06] text-white/55 hover:text-white/85 hover:bg-white/[0.08] transition-colors"
      >
        <Bell className="w-3.5 h-3.5" />
        <span aria-hidden="true" className="text-[10px] uppercase tracking-[0.2em]">Inbox</span>
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
                aria-label="Close Vorath inbox"
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
                        Vorath inbox
                      </h2>
                      <p className="text-[10px] text-white/35 mt-0.5">What Vorath wants your attention on</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close Vorath inbox"
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
                      <p className="text-[10px] text-white/30 mt-1">Vorath will surface asks and proposals here.</p>
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
                                    placeholder="Answer Vorath…"
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
                            <Bell className="w-3 h-3" /> Vorath says · {notifies.length}
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
                            {proposals.map((proposal) => (
                              <InboxProposalItem
                                key={proposal.id}
                                item={proposal}
                                working={workingId === proposal.id}
                                decision={goalDecisions[proposal.id]}
                                onResolveVoiceNote={resolveVoiceNote}
                                onDecide={decideGoal}
                                onResolve={resolveItem}
                              />
                            ))}
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
