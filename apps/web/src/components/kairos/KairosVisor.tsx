'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, Send, Sparkles, X } from 'lucide-react'
import { useKairosVisorStore } from '@/stores/kairosVisorStore'
import {
  listKairosThreads,
  loadKairosThread,
  sendKairosMessage,
  startKairosThread,
  type KairosChatActionResult,
} from '@/lib/actions/kairos-chat'
import type { ChatMessage, ChatThreadSummary } from '@/lib/data/kairos-chat'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C1) — slide-out chat panel.
//
// Right-edge overlay, ~420px wide. Three states inside:
//   - thread picker (no active thread): list of recent threads + "new"
//   - new-thread composer (active=null, intent=new): pick Dominion + send
//   - thread view (active thread loaded): messages + composer
//
// Bare chat — no per-message memory retrieval yet (C2). System prompt
// is persona + Dominion vision/mission only.
// ─────────────────────────────────────────────────────────────────────────

interface DominionOption {
  id: string
  name: string
}

interface KairosVisorProps {
  // Pre-fetched on the server so the picker opens instantly without a
  // round-trip. If empty, the panel surfaces a "create a Dominion first"
  // hint instead of a chat composer.
  dominions: DominionOption[]
}

const PANEL_WIDTH = 440

export function KairosVisor({ dominions }: KairosVisorProps) {
  const { isOpen, close, activeThreadId, setActiveThread } = useKairosVisorStore()
  const [threads, setThreads] = useState<ChatThreadSummary[]>([])
  const [activeThread, setActiveThreadData] = useState<{
    summary: ChatThreadSummary
    messages: ChatMessage[]
  } | null>(null)
  const [composing, setComposing] = useState(false) // true = new-thread mode
  const [selectedDominionId, setSelectedDominionId] = useState<string>(
    dominions[0]?.id ?? '',
  )
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load thread list when the Visor opens.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    listKairosThreads({ limit: 30 })
      .then((rows) => { if (!cancelled) setThreads(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load threads') })
    return () => { cancelled = true }
  }, [isOpen])

  // Load active thread when the id changes (or on first open if persisted).
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
  }, [isOpen, activeThreadId, setActiveThread])

  // Escape closes the Visor.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // Autofocus the composer when the Visor opens with a thread or new
  // conversation surface (i.e. anything that renders the textarea).
  useEffect(() => {
    if (!isOpen) return
    if (!composing && !activeThread) return
    // The slide-in animation completes around 250ms; wait one frame past
    // mount to avoid stealing focus during the animation's first paint.
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [isOpen, composing, activeThread])

  // Auto-scroll the message stream to the latest reply.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [activeThread?.messages.length])

  const handleSubmit = useCallback(async () => {
    const body = draft.trim()
    if (!body || pending) return
    setError(null)
    setPending(true)
    let result: KairosChatActionResult
    try {
      if (composing || !activeThread) {
        if (!selectedDominionId) {
          setError('Pick a Dominion to anchor the conversation.')
          setPending(false)
          return
        }
        result = await startKairosThread({ dominionId: selectedDominionId, body })
      } else {
        result = await sendKairosMessage({ threadId: activeThread.summary.id, body })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed')
      setPending(false)
      return
    }

    if (!result.ok) {
      setError(formatReason(result.reason, result.message))
      // The user message was already persisted (we persist BEFORE the AI
      // call so a model failure never loses input). Clear the draft so
      // the user doesn't retype + double-send; the next send call will
      // detect the orphan user message and retry just the AI half.
      const aiFailure = result.reason === 'ai_empty' || result.reason === 'ai_failed' || result.reason === 'no_credential'
      if (aiFailure) setDraft('')
      setPending(false)
      return
    }

    setDraft('')
    setComposing(false)
    setActiveThread(result.threadId)
    // Refresh the thread + list. The active-thread useEffect re-runs on
    // setActiveThread, so we only need to nudge the list refresh here.
    listKairosThreads({ limit: 30 })
      .then(setThreads)
      .catch(() => { /* non-fatal — list will refresh next open */ })
    setPending(false)
  }, [draft, pending, composing, activeThread, selectedDominionId, setActiveThread])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter sends. Plain Enter inserts a newline so multi-line
    // reflections / questions are easy to compose.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const headerLabel = useMemo(() => {
    if (composing || !activeThread) {
      return composing ? 'New conversation' : 'Kairos'
    }
    const domName = activeThread.summary.dominionName ?? 'Dominion'
    return `${domName} · ${activeThread.summary.title}`
  }, [composing, activeThread])

  if (dominions.length === 0) {
    return (
      <AnimatePresence>
        {isOpen && (
          <VisorShell width={PANEL_WIDTH} onClose={close}>
            <div className="p-6 text-sm text-zinc-400">
              <p>Create a Dominion first to start talking to Kairos. Open the cosmic view and add one.</p>
            </div>
          </VisorShell>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <VisorShell width={PANEL_WIDTH} onClose={close}>
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 px-4 py-3 backdrop-blur">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <h2 className="flex-1 truncate text-sm font-medium text-zinc-100">{headerLabel}</h2>
            <button
              onClick={() => { setComposing(true); setActiveThread(null); setDraft('') }}
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              title="New conversation"
              type="button"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={close}
              className="rounded-md p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
              title="Close"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {!composing && !activeThread && (
              <ThreadList
                threads={threads}
                onPick={(id) => setActiveThread(id)}
                onNew={() => setComposing(true)}
              />
            )}

            {composing && (
              <NewThreadHeader
                dominions={dominions}
                selectedId={selectedDominionId}
                onSelect={setSelectedDominionId}
              />
            )}

            {!composing && activeThread && (
              <MessageStream
                messages={activeThread.messages}
                scrollRef={scrollRef}
              />
            )}
          </div>

          {/* Composer (always rendered unless in thread-picker idle state) */}
          {(composing || activeThread) && (
            <div className="border-t border-zinc-800 bg-zinc-950/70 p-3">
              {error && (
                <div className="mb-2 rounded-md border border-red-800/60 bg-red-950/40 px-2 py-1 text-xs text-red-300">
                  {error}
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={composing
                    ? 'Start the conversation. Cmd/Ctrl+Enter to send.'
                    : 'Reply. Cmd/Ctrl+Enter to send.'}
                  rows={3}
                  disabled={pending}
                  className="flex-1 resize-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-purple-600 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={pending || !draft.trim()}
                  className="rounded-md bg-purple-600 p-2 text-white transition hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Send (Cmd/Ctrl+Enter)"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </VisorShell>
      )}
    </AnimatePresence>
  )
}

function VisorShell({ width, onClose, children }: { width: number; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-label="Kairos chat"
        className="fixed right-0 top-0 z-50 flex h-screen flex-col bg-zinc-950 border-l border-zinc-800 shadow-2xl"
        style={{ width }}
        initial={{ x: width }}
        animate={{ x: 0 }}
        exit={{ x: width }}
        transition={{ type: 'spring', stiffness: 320, damping: 36 }}
      >
        {children}
      </motion.aside>
    </>
  )
}

function ThreadList({
  threads,
  onPick,
  onNew,
}: {
  threads: ChatThreadSummary[]
  onPick: (id: string) => void
  onNew: () => void
}) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-zinc-400">No conversations yet.</p>
        <button
          onClick={onNew}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-500"
          type="button"
        >
          Start one
        </button>
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-y-auto p-2">
      {threads.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className="w-full rounded-md px-3 py-2 text-left transition hover:bg-zinc-900"
          type="button"
        >
          <div className="truncate text-sm text-zinc-100">{t.title}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {t.dominionName ?? 'Unanchored'} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  )
}

function NewThreadHeader({
  dominions,
  selectedId,
  onSelect,
}: {
  dominions: DominionOption[]
  selectedId: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="border-b border-zinc-900 bg-zinc-950 p-3">
      <label className="block text-xs uppercase tracking-wider text-zinc-500">Anchor to</label>
      <select
        value={selectedId}
        onChange={(e) => onSelect(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-purple-600 focus:outline-none"
      >
        {dominions.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
    </div>
  )
}

function MessageStream({
  messages,
  scrollRef,
}: {
  messages: ChatMessage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
      {messages.length === 0 && (
        <div className="text-center text-xs text-zinc-500">Conversation is empty — say something.</div>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-purple-600 px-3 py-2 text-sm text-white'
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100'
        }
      >
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  )
}

type FailReason = Extract<KairosChatActionResult, { ok: false }>['reason']

function formatReason(reason: FailReason, message?: string): string {
  switch (reason) {
    case 'unauthorized':       return 'Not signed in.'
    case 'dominion_not_found': return 'That Dominion is not accessible.'
    case 'thread_not_found':   return 'Thread was removed.'
    case 'no_credential':      return 'No BYOK credential — add an API key in settings.'
    case 'ai_empty':           return 'Kairos returned an empty reply. Try again.'
    case 'ai_failed':          return message ? `Kairos failed: ${message}` : 'Kairos failed. Try again.'
    case 'invalid_input':      return message ? `Invalid input: ${message}` : 'Invalid input.'
    default:                   return 'Something went wrong.'
  }
}
