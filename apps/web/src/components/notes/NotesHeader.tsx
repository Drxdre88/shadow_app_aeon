'use client'

import { useEffect, useState } from 'react'
import { Search, Pin } from 'lucide-react'

export type FilterState = {
  q: string
  sources: string[]
  types: string[]
  anchor: 'all' | 'anchored' | 'unanchored'
  pinnedOnly: boolean
}

const SOURCES = ['manual', 'claude', 'codex', 'copilot', 'voice', 'hook', 'import'] as const
const TYPES = ['note', 'decision', 'idea', 'observation', 'session_summary', 'reflection'] as const

type Props = {
  value: FilterState
  onChange: (next: FilterState) => void
  tagSuggestions: string[]
}

export function NotesHeader({ value, onChange, tagSuggestions: _tagSuggestions }: Props) {
  const [query, setQuery] = useState(value.q)

  // Debounce search so we're not re-fetching on every keystroke.
  useEffect(() => {
    if (query === value.q) return
    const t = setTimeout(() => onChange({ ...value, q: query }), 200)
    return () => clearTimeout(t)
  }, [query, value, onChange])

  // Keep input in sync if filters are reset elsewhere.
  useEffect(() => { setQuery(value.q) }, [value.q])

  const toggle = <K extends 'sources' | 'types'>(key: K, item: string) => {
    const set = new Set(value[key])
    if (set.has(item)) set.delete(item)
    else set.add(item)
    onChange({ ...value, [key]: [...set] })
  }

  return (
    <div className="flex flex-col gap-2 px-4 sm:px-6 py-3 border-b border-white/[0.05] bg-black/30 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-white/35" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories…"
          className="flex-1 bg-transparent outline-none text-sm text-white/85 placeholder:text-white/30"
        />
        <PinToggle
          active={value.pinnedOnly}
          onClick={() => onChange({ ...value, pinnedOnly: !value.pinnedOnly })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <ChipGroup
          label="Source"
          items={SOURCES as readonly string[]}
          active={value.sources}
          onToggle={(s) => toggle('sources', s)}
        />
        <Sep />
        <ChipGroup
          label="Type"
          items={TYPES as readonly string[]}
          active={value.types}
          onToggle={(t) => toggle('types', t)}
        />
        <Sep />
        <AnchorChip
          value={value.anchor}
          onChange={(a) => onChange({ ...value, anchor: a })}
        />
      </div>
    </div>
  )
}

function PinToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={active ? 'Showing pinned only' : 'Show pinned only'}
      className={`p-1.5 rounded-md transition-colors ${
        active ? 'bg-amber-500/15 text-amber-200' : 'text-white/35 hover:text-white/75 hover:bg-white/[0.06]'
      }`}
    >
      <Pin className="w-3.5 h-3.5" />
    </button>
  )
}

function ChipGroup({
  label, items, active, onToggle,
}: {
  label: string
  items: readonly string[]
  active: string[]
  onToggle: (item: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-white/30 uppercase tracking-[0.18em] mr-1">{label}</span>
      {items.map((item) => {
        const on = active.includes(item)
        return (
          <button
            key={item}
            onClick={() => onToggle(item)}
            className={`px-1.5 py-0.5 rounded-md border transition-colors ${
              on
                ? 'bg-white/[0.12] border-white/[0.18] text-white/90'
                : 'border-white/[0.06] text-white/45 hover:text-white/75 hover:border-white/[0.12]'
            }`}
          >
            {item}
          </button>
        )
      })}
    </div>
  )
}

function AnchorChip({ value, onChange }: { value: FilterState['anchor']; onChange: (a: FilterState['anchor']) => void }) {
  const options: { id: FilterState['anchor']; label: string }[] = [
    { id: 'all',         label: 'all' },
    { id: 'anchored',    label: 'anchored' },
    { id: 'unanchored',  label: 'unanchored' },
  ]
  return (
    <div className="flex items-center gap-1">
      <span className="text-white/30 uppercase tracking-[0.18em] mr-1">Anchor</span>
      <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`px-1.5 py-0.5 rounded transition-colors ${
              value === o.id
                ? 'bg-white/[0.12] text-white/90'
                : 'text-white/45 hover:text-white/75'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Sep() {
  return <span className="text-white/15 mx-1">•</span>
}
