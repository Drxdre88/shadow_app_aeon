'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, Check, Inbox, MessageCircleQuestion, X } from 'lucide-react'
import {
  acceptKairosInboxProposal,
  answerKairosInboxAsk,
  dismissKairosInboxProposal,
  listKairosInbox,
} from '@/lib/actions/kairos-inbox'

type InboxData = Awaited<ReturnType<typeof listKairosInbox>>

export function KairosInbox() {
  const [data, setData] = useState<InboxData>({ ask: null, proposals: [] })
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [workingId, setWorkingId] = useState<string | null>(null)
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

  const count = (data.ask ? 1 : 0) + data.proposals.length

  const submitAnswer = async () => {
    if (!data.ask || !answer.trim()) return
    setWorkingId(data.ask.id)
    setError(null)
    try {
      await answerKairosInboxAsk(data.ask.id, answer)
      setAnswer('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to answer Kairos')
    } finally {
      setWorkingId(null)
    }
  }

  const resolveProposal = async (id: string, resolution: 'accept' | 'dismiss') => {
    setWorkingId(id)
    setError(null)
    try {
      if (resolution === 'accept') await acceptKairosInboxProposal(id)
      else await dismissKairosInboxProposal(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${resolution} proposal`)
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
          <span className="absolute -right-1.5 -top-1.5 min-w-4 h-4 px-1 rounded-full bg-violet-500 text-[9px] leading-4 font-semibold text-white shadow-[0_0_10px_rgba(139,92,246,0.65)]">
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
                      {data.ask && (
                        <section>
                          <div className="flex items-center gap-1.5 mb-2 text-[10px] uppercase tracking-[0.2em] text-violet-200/70">
                            <MessageCircleQuestion className="w-3 h-3" /> Pending ask
                          </div>
                          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
                            <p className="text-[13px] leading-relaxed text-white/85">{data.ask.title}</p>
                            <textarea
                              value={answer}
                              onChange={(event) => setAnswer(event.target.value)}
                              rows={4}
                              maxLength={10_000}
                              placeholder="Answer Kairos…"
                              className="mt-3 w-full resize-none rounded-lg bg-black/20 border border-white/[0.08] px-3 py-2 text-[12px] leading-relaxed text-white/85 placeholder:text-white/30 outline-none focus:border-violet-400/35"
                            />
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={submitAnswer}
                                disabled={!answer.trim() || workingId === data.ask.id}
                                className="px-3 py-1.5 rounded-md bg-violet-500/20 border border-violet-400/20 text-[10px] uppercase tracking-[0.16em] text-violet-100 hover:bg-violet-500/30 disabled:opacity-35 disabled:cursor-not-allowed"
                              >
                                {workingId === data.ask.id ? 'Sending…' : 'Send answer'}
                              </button>
                            </div>
                          </div>
                        </section>
                      )}

                      {data.proposals.length > 0 && (
                        <section>
                          <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/45">
                            Inbound proposals · {data.proposals.length}
                          </div>
                          <ul className="flex flex-col gap-2">
                            {data.proposals.map((proposal) => {
                              const working = workingId === proposal.id
                              return (
                                <li key={proposal.id} className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4">
                                  <h3 className="text-[12px] font-medium text-white/85">{proposal.title}</h3>
                                  {proposal.summary && proposal.summary !== proposal.title && (
                                    <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">{proposal.summary}</p>
                                  )}
                                  <div className="mt-3 flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => resolveProposal(proposal.id, 'accept')}
                                      disabled={working}
                                      className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
                                    >
                                      {working ? 'Working…' : 'Accept'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => resolveProposal(proposal.id, 'dismiss')}
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
