'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HelpCircle, Undo2 } from 'lucide-react'
import { getMemoryWhy, undoMemoryChange } from '@/lib/actions/memory-knows'
import { isHeldSensitive } from '@/lib/kairos/sensitive/meta'
import { originWords, opWords, recheckWords, sensitiveWords, sourceRef, standingWords, whyLine, type ProvenanceRow } from './provenance'

type Why = Awaited<ReturnType<typeof getMemoryWhy>>

const NOT_UNDOABLE = new Set(['revert', 'concept_create', 'score'])

// "Why do I know this?" — who wrote it, where from, how firmly it is held,
// what it rests on, and every recorded change with an Undo where possible.
export function WhyPanel({ memory, onChanged }: { memory: ProvenanceRow & { id: string; updatedAt: Date | string }; onChanged: () => void }) {
  const [why, setWhy] = useState<Why | null>(null)
  const [busyOp, setBusyOp] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const stamp = String(memory.updatedAt)

  useEffect(() => {
    let cancelled = false
    setWhy(null)
    getMemoryWhy(memory.id)
      .then((w) => { if (!cancelled) setWhy(w) })
      .catch(() => { if (!cancelled) setWhy(null) })
    return () => { cancelled = true }
  }, [memory.id, stamp])

  const undo = async (opId: string) => {
    setBusyOp(opId)
    setError(null)
    try {
      await undoMemoryChange(opId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That change can\u2019t be undone.')
    } finally {
      setBusyOp(null)
    }
  }

  const source = sourceRef(memory)
  const sensitive = sensitiveWords(memory.sourceMetadata)
  const recheck = recheckWords(memory.sourceMetadata)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/40 inline-flex items-center gap-1.5">
        <HelpCircle className="w-3 h-3" /> Why do I know this?
      </span>
      <div className="px-3 py-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] flex flex-col gap-1.5 text-[11.5px] leading-snug">
        <p className="text-white/80">{whyLine(memory)}</p>
        <Fact label="Written by">{originWords(memory)}</Fact>
        <Fact label="Came from">
          {source.href ? <Link href={source.href} className="underline decoration-white/25 hover:text-white">{source.label}</Link> : source.label}
        </Fact>
        <Fact label="How sure">{standingWords(memory)}</Fact>
        {why?.dominionName && <Fact label="Area">{why.dominionName}</Fact>}
        {sensitive && (
          <Fact label="Private topic">
            {sensitive}{isHeldSensitive(memory.sourceMetadata) ? ' \u2014 held until you confirm it' : ''}
          </Fact>
        )}
        {recheck && <Fact label="Needs a re-check">{recheck}</Fact>}
      </div>

      {why && why.supports.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">Rests on</span>
          <ul className="flex flex-col gap-1">
            {why.supports.map((s) => (
              <li key={s.id} className="text-[11px] text-white/70 leading-snug px-2 py-1 rounded border border-white/[0.04]">
                {s.title} <span className="text-white/35">· {originWords(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {why && why.ops.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">Changes</span>
          <ul className="flex flex-col gap-1">
            {why.ops.map((op) => (
              <li key={op.id} className="flex items-start gap-2 text-[10.5px] leading-snug px-2 py-1 rounded border border-white/[0.04]">
                <span className="text-white/30 shrink-0 tabular-nums">{new Date(op.createdAt).toLocaleDateString()}</span>
                <span className={`flex-1 ${op.revertedAt ? 'text-white/35 line-through decoration-white/15' : 'text-white/70'}`} title={op.reason}>
                  {opWords(op)}
                </span>
                {!op.revertedAt && !NOT_UNDOABLE.has(op.op) && (
                  <button
                    onClick={() => undo(op.id)}
                    disabled={busyOp === op.id}
                    className="shrink-0 inline-flex items-center gap-1 text-white/45 hover:text-white disabled:opacity-30"
                  >
                    <Undo2 className="w-3 h-3" /> Undo
                  </button>
                )}
              </li>
            ))}
          </ul>
          {error && <div className="text-[10.5px] text-rose-300/90">{error}</div>}
        </div>
      )}
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-[92px] shrink-0 text-white/35">{label}</span>
      <span className="text-white/75">{children}</span>
    </div>
  )
}
