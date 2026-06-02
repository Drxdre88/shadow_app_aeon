'use client'

interface DominionOption {
  id: string
  name: string
}

export function KairosNewThreadHeader({
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
