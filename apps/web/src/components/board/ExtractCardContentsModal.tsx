'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Loader2, X } from 'lucide-react'
import { getChecklistItems } from '@/lib/actions/checklist'
import { useBoardStore, useLabels } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'
import { resolvePriority } from '@/lib/utils/priorities'
import { buildCardContents, cardContentsHtml, cardContentsText, type CardContentsItem } from '@/lib/utils/card-contents'

export function ExtractCardContentsModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [items, setItems] = useState<CardContentsItem[] | null>(null)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const labels = useLabels()
  const task = useBoardStore((state) => state.tasks.find((entry) => entry.id === taskId))
  const projectId = task?.projectId
  const priorities = useThemeStore((state) => state.priorities)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectId) return
    let active = true
    getChecklistItems(taskId, projectId)
      .then((result) => { if (active) setItems(result) })
      .catch(() => { if (active) setError('Could not load the complete checklist. Try again.') })
    return () => { active = false }
  }, [taskId, projectId])

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const contents = task && items && buildCardContents(task, items, labels, resolvePriority(priorities, task.priority).name)

  const copy = async () => {
    if (!contents) return
    const plain = cardContentsText(contents)
    const rich = cardContentsHtml(contents)
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([rich], { type: 'text/html' }),
        })])
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain)
      } else {
        throw new Error('Clipboard unavailable')
      }
      setCopyStatus('copied')
    } catch {
      try {
        await navigator.clipboard.writeText(plain)
        setCopyStatus('copied')
      } catch {
        setCopyStatus('failed')
      }
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/65 p-3 sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extract-card-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[min(90vh,800px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[var(--background)] text-[var(--text)] shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <h2 id="extract-card-title" className="text-base font-semibold">Extract contents</h2>
            <p className="mt-0.5 text-xs opacity-60">A clean copy of this card</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={copy} disabled={!contents} aria-label="Copy card contents" title="Copy card contents" className="rounded-md p-2 opacity-70 transition hover:bg-white/10 hover:opacity-100 disabled:opacity-30">
              {copyStatus === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onClose} aria-label="Close extraction" className="rounded-md p-2 opacity-70 transition hover:bg-white/10 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-5 select-text sm:px-7">
          {!task ? <p role="alert" className="text-sm text-red-400">Card no longer available.</p> : error ? <p role="alert" className="text-sm text-red-400">{error}</p> : !contents ? (
            <p role="status" className="flex items-center gap-2 text-sm opacity-65"><Loader2 className="h-4 w-4 animate-spin" />Loading complete card contents…</p>
          ) : (
            <div className="space-y-5 text-sm leading-relaxed">
              <section><h3 className="font-semibold">Title</h3><p className="mt-1 whitespace-pre-wrap break-words">{contents.title}</p></section>
              <section><h3 className="font-semibold">Description</h3><p className="mt-1 whitespace-pre-wrap break-words">{contents.description || <span className="opacity-55">None</span>}</p></section>
              <section>
                <h3 className="font-semibold">Checklists</h3>
                {contents.groups.length ? contents.groups.map((group) => (
                  <div key={group.name} className="mt-2">
                    <h4 className="font-semibold">{group.name}</h4>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{group.items.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul>
                  </div>
                )) : <p className="mt-1 opacity-55">None</p>}
              </section>
              <section><h3 className="font-semibold">Labels</h3>{contents.labels.length ? <ul className="mt-1 list-disc pl-5">{contents.labels.map((label, index) => <li key={index}>{label}</li>)}</ul> : <p className="mt-1 opacity-55">None</p>}</section>
              <section><h3 className="font-semibold">Priority</h3><p className="mt-1">{contents.priority}</p></section>
            </div>
          )}
          {copyStatus === 'copied' && <p role="status" className="mt-5 text-xs text-emerald-400">Copied to clipboard</p>}
          {copyStatus === 'failed' && <p role="alert" className="mt-5 text-xs text-amber-400">Copy was blocked. Select the text above and copy it manually.</p>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
