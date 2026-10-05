'use client'

import { useEffect, useState } from 'react'
import { listWhatVorathKnows } from '@/lib/actions/memory-knows'
import { groupByDominion } from './groups'
import { standingWords, whyLine } from './provenance'
import { useKnowsStore } from './knowsStore'

type KnownRow = Awaited<ReturnType<typeof listWhatVorathKnows>>[number]

export function KnowsList({ onSelect }: { onSelect: (id: string) => void }) {
  const version = useKnowsStore((s) => s.version)
  const [rows, setRows] = useState<KnownRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listWhatVorathKnows()
      .then((r) => { if (!cancelled) { setRows(r); setError(null) } })
      .catch(() => { if (!cancelled) setError('Couldn\u2019t load what I know right now.') })
    return () => { cancelled = true }
  }, [version])

  if (error) return <Muted>{error}</Muted>
  if (!rows) return <Muted>Loading…</Muted>
  if (rows.length === 0) return <Muted>I don&rsquo;t hold any beliefs or facts about you yet.</Muted>

  return (
    <div className="flex flex-col gap-4">
      {groupByDominion(rows).map((group) => (
        <section key={group.key} className="flex flex-col gap-1.5">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/45">
            {group.name} <span className="text-white/25 normal-case tracking-normal">· {group.rows.length}</span>
          </h3>
          <ul className="flex flex-col gap-1">
            {group.rows.map((row) => (
              <li key={row.id}>
                <button
                  onClick={() => onSelect(row.id)}
                  className="w-full text-left px-2.5 py-2 rounded-lg border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.05] hover:border-white/[0.10] transition-all"
                >
                  <div className="flex items-start gap-2">
                    <span className="flex-1 text-[12px] text-white/85 leading-snug line-clamp-2">{row.aiTitle ?? row.title}</span>
                    <span className="shrink-0 text-[10px] text-white/35">{standingWords(row)}</span>
                  </div>
                  <div className="text-[10.5px] text-white/45 leading-snug mt-0.5 line-clamp-2">{whyLine(row)}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <div className="px-1 py-3 text-[11.5px] text-white/40 leading-relaxed">{children}</div>
}
