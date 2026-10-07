'use client'

import { useState } from 'react'
import { ChevronDown, Mic } from 'lucide-react'
import type { VoiceNoteItem } from './inbox-types'

// One card per voice note: confirm or discard every pending part at once.
export function VoiceNoteCard({
  note,
  working,
  onResolve,
}: {
  note: VoiceNoteItem
  working: boolean
  onResolve: (noteId: string, resolution: 'confirm' | 'discard') => void
}) {
  const [expanded, setExpanded] = useState(false)
  const waiting = note.segments.length
  return (
    <li className="rounded-xl bg-white/[0.04] border border-violet-300/15 p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[12px] font-medium text-white/85">
          <Mic className="inline w-3 h-3 mr-1.5 -mt-0.5 text-violet-200/75" aria-hidden="true" />
          {note.parts > 1 ? `Voice note · ${note.parts} parts` : 'Voice note'}
        </h3>
        {waiting < note.parts && (
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-[0.14em] bg-white/[0.05] text-white/45 border border-white/[0.08]">
            {waiting} of {note.parts} waiting
          </span>
        )}
      </div>
      {note.summary && <p className="mt-1.5 text-[11px] leading-relaxed text-white/60 italic">“{note.summary}”</p>}
      {waiting > 1 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.16em] text-white/40 hover:text-white/70"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
          {expanded ? 'Hide parts' : `Show ${waiting} parts`}
        </button>
      )}
      {expanded && (
        <ol className="mt-2 flex flex-col gap-1.5 text-[11px] leading-relaxed text-white/50">
          {note.segments.map((segment) => (
            <li key={segment.id}>
              <span className="mr-1.5 font-mono text-[10px] text-white/30">{segment.voiceNote?.part ?? '·'}</span>
              {segment.summary ?? segment.title}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onResolve(note.id, 'confirm')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-400/15 text-[10px] uppercase tracking-[0.16em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-35"
        >
          {working ? 'Working…' : 'Confirm all'}
        </button>
        <button
          type="button"
          onClick={() => onResolve(note.id, 'discard')}
          disabled={working}
          className="px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35"
        >
          Discard
        </button>
      </div>
    </li>
  )
}
