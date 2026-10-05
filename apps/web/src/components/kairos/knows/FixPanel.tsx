'use client'

import { useState } from 'react'
import { Check, Pencil, ThumbsDown, Undo2 } from 'lucide-react'
import { confirmMemory, editMemoryInPlace, markMemoryWrong, undoMemoryChange } from '@/lib/actions/memory-knows'
import { isGoalRow } from '@/lib/kairos/goals/guards'
import { originKindOf } from '@/lib/kairos/origin'
import { MIND_NAME } from '@/lib/kairos/identity'

export type FixableMemory = {
  id: string
  title: string
  bodyMd: string
  type: string
  streamClass: string
  source: string
  sourceMetadata: unknown
  archivedAt: Date | string | null
}

type Mode = 'idle' | 'edit' | 'wrong'

export function protectedNote(m: Pick<FixableMemory, 'type' | 'streamClass' | 'sourceMetadata'>): string | null {
  if (m.type === 'constitution' || m.streamClass === 'constitution') return `${MIND_NAME}\u2019s constitution only changes through an amendment you accept in the inbox.`
  if (isGoalRow(m)) return 'Goals change through the goal flow (approve, veto or close).'
  return null
}

export function isBeliefRow(m: Pick<FixableMemory, 'type' | 'streamClass'>): boolean {
  return m.type === 'belief' || m.streamClass === 'belief'
}

// Fix in place: edit the words (not beliefs — they are rebuilt from notes),
// confirm it is right, or mark it wrong (reversible).
export function FixPanel({ memory, onChanged }: { memory: FixableMemory; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [title, setTitle] = useState(memory.title)
  const [body, setBody] = useState(memory.bodyMd)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undoOpId, setUndoOpId] = useState<string | null>(null)

  const locked = protectedNote(memory)
  if (locked) return <p className="text-[10.5px] text-white/40 leading-snug">{locked}</p>

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn\u2019t work.')
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(async () => {
    await editMemoryInPlace(memory.id, { title, bodyMd: body })
    setMode('idle')
  })
  const markWrong = () => run(async () => {
    const res = await markMemoryWrong(memory.id, reason)
    setUndoOpId(res.ok ? res.opId : null)
    setMode('idle')
    setReason('')
  })
  const undo = () => run(async () => {
    if (undoOpId) await undoMemoryChange(undoOpId)
    setUndoOpId(null)
  })
  const confirm = () => run(async () => { await confirmMemory(memory.id) })

  const archived = !!memory.archivedAt
  const notOwners = originKindOf(memory) !== 'operator'

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/40">Fix it</span>

      {archived ? (
        <div className="flex items-center gap-2 text-[11px] text-white/55">
          <span className="flex-1">Set aside &mdash; {MIND_NAME} no longer uses this.</span>
          {undoOpId && <TextBtn onClick={undo} disabled={busy}><Undo2 className="w-3 h-3" /> Undo</TextBtn>}
        </div>
      ) : mode === 'edit' ? (
        <div className="flex flex-col gap-1.5">
          <input aria-label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={255} className={FIELD} />
          <textarea aria-label="Text" value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={`${FIELD} resize-y`} />
          <div className="flex gap-1.5">
            <TextBtn onClick={save} disabled={busy || !title.trim() || !body.trim()} strong>Save</TextBtn>
            <TextBtn onClick={() => { setMode('idle'); setTitle(memory.title); setBody(memory.bodyMd) }} disabled={busy}>Cancel</TextBtn>
          </div>
        </div>
      ) : mode === 'wrong' ? (
        <div className="flex flex-col gap-1.5">
          <input aria-label="What's wrong" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="What's wrong with it?" className={FIELD} />
          <div className="flex gap-1.5">
            <TextBtn onClick={markWrong} disabled={busy || !reason.trim()} strong>Set it aside</TextBtn>
            <TextBtn onClick={() => setMode('idle')} disabled={busy}>Cancel</TextBtn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {!isBeliefRow(memory) && <TextBtn onClick={() => setMode('edit')} disabled={busy}><Pencil className="w-3 h-3" /> Edit</TextBtn>}
          {notOwners && <TextBtn onClick={confirm} disabled={busy}><Check className="w-3 h-3" /> It&rsquo;s right</TextBtn>}
          <TextBtn onClick={() => setMode('wrong')} disabled={busy}><ThumbsDown className="w-3 h-3" /> This is wrong</TextBtn>
        </div>
      )}
      {error && <div className="text-[10.5px] text-rose-300/90">{error}</div>}
    </div>
  )
}

const FIELD = 'w-full px-2 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[12px] text-white/85 outline-none focus:border-white/[0.2]'

function TextBtn({ children, onClick, disabled, strong }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; strong?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-all disabled:opacity-30 ${
        strong ? 'bg-white/[0.14] hover:bg-white/[0.2] text-white/90' : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/75'
      }`}
    >
      {children}
    </button>
  )
}
