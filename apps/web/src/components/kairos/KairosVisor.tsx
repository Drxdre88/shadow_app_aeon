'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Send, X } from 'lucide-react'
import { useKairosVisorStore } from '@/stores/kairosVisorStore'
import {
  listKairosThreads,
  loadKairosThread,
  sendKairosMessage,
  startKairosThread,
  type KairosChatActionResult,
} from '@/lib/actions/kairos-chat'
import type { ChatMessage, ChatThreadSummary } from '@/lib/data/kairos-chat'
import { KairosVisorShell } from './KairosVisorShell'
import { KairosThreadList } from './KairosThreadList'
import { KairosMessageStream } from './KairosMessageStream'
import { formatReason } from './kairos-citations'

// Full-screen Kairos AI — a two-pane takeover: always-visible history rail on
// the left, the active conversation on the right. Top-level orchestrator:
// state + send flow + composer. Subviews (shell, rail, message stream) live in
// sibling files so this stays the flow doc, not a render dump. Threads are
// whole-brain by default — no Dominion anchor at creation.

export function KairosVisor() {
  const { isOpen, close, activeThreadId, setActiveThread } = useKairosVisorStore()
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [activeThread, setActiveThreadData] = useState<{
    summary: ChatThreadSummary
    messages: ChatMessage[]
  } | null>(null)
  const [composing, setComposing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bump after every successful send so the thread-load useEffect re-fires
  // even when setActiveThread is called with the same id (the common case —
  // sending into an already-active thread).
  const [refreshNonce, setRefreshNonce] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    listKairosThreads({ limit: 30 })
      .then((rows) => { if (!cancelled) setThreads(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load threads') })
    return () => { cancelled = true }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !activeThreadId) {
      setActiveThreadData(null)
      return
    }
    let cancelled = false
    loadKairosThread({ threadId: activeThreadId })
      .then((loaded) => {
        if (cancelled) return
        if (!loaded) {
          setActiveThread(null)
          return
        }
        setActiveThreadData({ summary: loaded.thread, messages: loaded.messages })
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load thread') })
    return () => { cancelled = true }
  }, [isOpen, activeThreadId, refreshNonce, setActiveThread])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen) return
    if (!composing && !activeThread) return
    const id = window.setTimeout(() => textareaRef.current?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [isOpen, composing, activeThread])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [activeThread?.messages.length])

  const handleSubmit = useCallback(async () => {
    const body = draft.trim()
    if (!body || pending) return
    // Capture send intent up-front so post-await store writes don't act on a
    // thread the user has since navigated away from.
    const wasComposing = composing || !activeThread
    const sentToThreadId = activeThread?.summary.id ?? null
    setError(null)
    setPending(true)
    let result: KairosChatActionResult
    try {
      if (wasComposing) {
        result = await startKairosThread({ body })
      } else {
        result = await sendKairosMessage({ threadId: sentToThreadId!, body })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
      setPending(false)
      return
    }

    if (!result.ok) {
      setError(formatReason(result.reason, result.message))
      // User msg was already persisted (persist-before-AI). Clear draft so the
      // next send retries the AI half. If the thread was created (AI-failure on
      // a new thread), commit to it so the retry replies into THIS thread
      // instead of starting a duplicate.
      const aiFailure = result.reason === 'ai_empty' || result.reason === 'ai_failed' || result.reason === 'no_credential'
      if (aiFailure) {
        setDraft('')
        if (result.threadId) {
          setComposing(false)
          setActiveThread(result.threadId)
          setRefreshNonce((n) => n + 1)
          listKairosThreads({ limit: 30 }).then(setThreads).catch(() => { /* non-fatal */ })
        }
      }
      setPending(false)
      return
    }

    setDraft('')
    setComposing(false)
    // Only switch the view to the send's thread if the user hasn't navigated
    // to a different one while the request was in flight.
    const liveActive = useKairosVisorStore.getState().activeThreadId
    if (wasComposing || liveActive === sentToThreadId || liveActive === null) {
      setActiveThread(result.threadId)
    }
    setRefreshNonce((n) => n + 1)
    listKairosThreads({ limit: 30 })
      .then(setThreads)
      .catch(() => { /* non-fatal */ })
    setPending(false)
  }, [draft, pending, composing, activeThread, setActiveThread])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const headerLabel = useMemo(() => {
    if (composing) return 'New conversation'
    if (!activeThread) return 'Kairos'
    const domName = activeThread.summary.dominionName
    return domName ? `${domName} · ${activeThread.summary.title}` : activeThread.summary.title
  }, [composing, activeThread])

  const startNew = useCallback(() => {
    setComposing(true)
    setActiveThread(null)
    setDraft('')
    setError(null)
  }, [setActiveThread])

  const showComposer = composing || !!activeThread

  return (
    <AnimatePresence>
      {isOpen && (
        <KairosVisorShell onClose={close}>
          <KairosThreadList
            threads={threads}
            activeId={composing ? null : activeThread?.summary.id ?? null}
            onPick={(id) => { setComposing(false); setActiveThread(id) }}
            onNew={startNew}
          />

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-5 py-3">
              <Avatar size={26} />
              <h2 className="flex-1 truncate text-sm font-medium text-zinc-100">{headerLabel}</h2>
              <button
                onClick={close}
                className="rounded-md p-1.5 text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-100"
                title="Close (Esc)"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            {activeThread && !composing ? (
              <KairosMessageStream messages={activeThread.messages} scrollRef={scrollRef} />
            ) : composing ? (
              <div className="flex-1" />
            ) : (
              <EmptyState onNew={startNew} />
            )}

            {/* Composer */}
            {showComposer && (
              <div className="shrink-0 border-t border-white/[0.06] px-6 pb-5 pt-3">
                <div className="mx-auto w-full max-w-[760px]">
                  {error && (
                    <div className="mb-2 rounded-md border border-red-800/60 bg-red-950/40 px-2.5 py-1.5 text-xs text-red-300">
                      {error}
                    </div>
                  )}
                  <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2 transition focus-within:border-purple-600/60">
                    <textarea
                      ref={textareaRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={onKeyDown}
                      placeholder={composing
                        ? 'Start the conversation. Cmd/Ctrl+Enter to send.'
                        : 'Reply. Cmd/Ctrl+Enter to send.'}
                      rows={2}
                      disabled={pending}
                      className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={pending || !draft.trim()}
                      className="rounded-lg bg-purple-600 p-2 text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Send (Cmd/Ctrl+Enter)"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </KairosVisorShell>
      )}
    </AnimatePresence>
  )
}

function Avatar({ size = 28 }: { size?: number }) {
  return (
    <span
      className="shrink-0 overflow-hidden rounded-full bg-zinc-900 bg-cover bg-center ring-1 ring-purple-400/30"
      style={{ width: size, height: size, backgroundImage: "url('/kairos_2.png')", boxShadow: '0 0 12px rgba(139,92,246,0.3)' }}
    />
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <Avatar size={72} />
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold tracking-wide text-zinc-100">Ask Kairos</h3>
        <p className="max-w-md text-sm text-zinc-400">
          Your whole memory, one conversation. Pick a past thread on the left, or start a new one.
        </p>
      </div>
      <button
        onClick={onNew}
        type="button"
        className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-500"
        style={{ boxShadow: '0 0 18px rgba(139,92,246,0.35)' }}
      >
        New conversation
      </button>
    </div>
  )
}
