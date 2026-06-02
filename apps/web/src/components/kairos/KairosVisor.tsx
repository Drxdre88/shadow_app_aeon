'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
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
import { KairosVisorShell } from './KairosVisorShell'
import { KairosThreadList } from './KairosThreadList'
import { KairosNewThreadHeader } from './KairosNewThreadHeader'
import { KairosMessageStream } from './KairosMessageStream'
import { formatReason } from './kairos-citations'

// Slide-out chat panel anchored to a Dominion. Top-level orchestrator —
// state + send flow + composer. Subviews (shell, picker, composer header,
// message stream + chip render) live in sibling files so this stays the
// flow doc, not a render dump.

interface DominionOption {
  id: string
  name: string
}

interface KairosVisorProps {
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
  const [composing, setComposing] = useState(false)
  const [selectedDominionId, setSelectedDominionId] = useState<string>(
    dominions[0]?.id ?? '',
  )
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  }, [isOpen, activeThreadId, setActiveThread])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  useEffect(() => {
    if (!isOpen) return
    if (!composing && !activeThread) return
    // Slide-in completes ~250ms; wait a tick to avoid stealing focus mid-paint.
    const id = window.setTimeout(() => textareaRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [isOpen, composing, activeThread])

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
      // User msg was already persisted (persist-before-AI). Clear draft so
      // the next send retries the AI half instead of double-posting.
      const aiFailure = result.reason === 'ai_empty' || result.reason === 'ai_failed' || result.reason === 'no_credential'
      if (aiFailure) setDraft('')
      setPending(false)
      return
    }

    setDraft('')
    setComposing(false)
    setActiveThread(result.threadId)
    listKairosThreads({ limit: 30 })
      .then(setThreads)
      .catch(() => { /* non-fatal */ })
    setPending(false)
  }, [draft, pending, composing, activeThread, selectedDominionId, setActiveThread])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          <KairosVisorShell width={PANEL_WIDTH} onClose={close}>
            <div className="p-6 text-sm text-zinc-400">
              <p>Create a Dominion first to start talking to Kairos. Open the cosmic view and add one.</p>
            </div>
          </KairosVisorShell>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <KairosVisorShell width={PANEL_WIDTH} onClose={close}>
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

          <div className="flex flex-1 flex-col overflow-hidden">
            {!composing && !activeThread && (
              <KairosThreadList
                threads={threads}
                onPick={(id) => setActiveThread(id)}
                onNew={() => setComposing(true)}
              />
            )}

            {composing && (
              <KairosNewThreadHeader
                dominions={dominions}
                selectedId={selectedDominionId}
                onSelect={setSelectedDominionId}
              />
            )}

            {!composing && activeThread && (
              <KairosMessageStream
                messages={activeThread.messages}
                scrollRef={scrollRef}
              />
            )}
          </div>

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
        </KairosVisorShell>
      )}
    </AnimatePresence>
  )
}
