'use client'

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { confirmMemory, listNeedsYourEyes, removeNeedsEyesMemory } from '@/lib/actions/memory-knows'
import { MIND_NAME } from '@/lib/kairos/identity'
import { originWords, recheckWords, sensitiveWords, sourceRef } from './provenance'
import { Muted } from './KnowsList'
import { useKnowsStore } from './knowsStore'

type EyesRow = Awaited<ReturnType<typeof listNeedsYourEyes>>[number]

export function reasonWords(row: Pick<EyesRow, 'reason' | 'sourceMetadata' | 'source'>): string {
  if (row.reason === 'sensitive') {
    const topics = sensitiveWords(row.sourceMetadata)
    return `Held back: it touches ${topics ?? 'a private topic'}. ${MIND_NAME} won\u2019t use it until you confirm.`
  }
  if (row.reason === 'recheck') return recheckWords(row.sourceMetadata) ?? 'Flagged for a re-check.'
  return `${originWords(row)} wrote this and it hasn\u2019t earned trust yet.`
}

export function NeedsEyesList({ onSelect }: { onSelect: (id: string) => void }) {
  const version = useKnowsStore((s) => s.version)
  const bump = useKnowsStore((s) => s.bump)
  const [rows, setRows] = useState<EyesRow[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listNeedsYourEyes()
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setError('Couldn\u2019t load this list right now.') })
    return () => { cancelled = true }
  }, [version])

  const act = async (id: string, fn: (id: string) => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    try {
      await fn(id)
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev)
      bump()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn\u2019t work.')
    } finally {
      setBusyId(null)
    }
  }

  if (!rows) return <Muted>{error ?? 'Loading…'}</Muted>
  if (rows.length === 0) return <Muted>Nothing needs your eyes right now.</Muted>

  return (
    <div className="flex flex-col gap-2">
      {error && <div className="text-[11px] text-rose-300/90 px-1">{error}</div>}
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.id} className="px-2.5 py-2 rounded-lg border border-white/[0.06] bg-white/[0.02]">
            <button onClick={() => onSelect(row.id)} className="w-full text-left">
              <div className="text-[12px] text-white/85 leading-snug line-clamp-2 hover:text-white">{row.aiTitle ?? row.title}</div>
              <div className="text-[10.5px] text-white/50 leading-snug mt-0.5">{reasonWords(row)}</div>
              <div className="text-[10px] text-white/30 mt-0.5">From {sourceRef(row).label}</div>
            </button>
            <div className="flex gap-1.5 mt-2">
              <SmallBtn onClick={() => act(row.id, confirmMemory)} disabled={busyId === row.id} label="Confirm" title="It's right — use it">
                <Check className="w-3 h-3" />
              </SmallBtn>
              <SmallBtn onClick={() => act(row.id, removeNeedsEyesMemory)} disabled={busyId === row.id} label="Remove" title="Set it aside (you can undo from the memory panel)" danger>
                <X className="w-3 h-3" />
              </SmallBtn>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SmallBtn({ children, label, title, onClick, disabled, danger }: {
  children: React.ReactNode
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold transition-all disabled:opacity-30 ${
        danger ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300' : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/80'
      }`}
    >
      {children}
      {label}
    </button>
  )
}
