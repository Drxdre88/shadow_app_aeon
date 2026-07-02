'use client'

const BOARD_CUSTOMIZABLE = [
  { key: 'S', action: 'Select card (hover) — enables arrow key movement' },
  { key: 'C', action: 'New card' },
  { key: 'E', action: 'Edit card (hover)' },
  { key: 'V', action: 'Change priority (hover)' },
  { key: 'L', action: 'Open label picker (hover)' },
  { key: 'G', action: 'Change card glow (hover)' },
  { key: 'X', action: 'Complete card — done / not-doing / none (hover)' },
  { key: 'D', action: 'Toggle due dates' },
  { key: 'O', action: 'Toggle checklist preview' },
  { key: 'M', action: 'Assign members (hover)' },
]

const BOARD_FIXED = [
  { key: 'Arrows', action: 'Move selected card (L/R: columns, U/D: reorder)' },
  { key: 'Ctrl+C', action: 'Copy card' },
  { key: 'Ctrl+V', action: 'Paste card' },
  { key: 'Double-click', action: 'Inline edit card title' },
]

const DASHBOARD = [
  { key: 'N', action: 'New project' },
  { key: '1-9', action: 'Switch realm (1 = All)' },
]

const GLOBAL = [
  { key: '?', action: 'Open help' },
  { key: 'Ctrl+K / /', action: 'Command palette' },
  { key: 'Ctrl+Z', action: 'Undo last delete' },
  { key: 'Escape', action: 'Close modal / deselect card' },
]

function ShortcutGroup({ title, items }: { title: string; items: { key: string; action: string }[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1.5">
        {items.map((s) => (
          <div key={s.key} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/[0.03]">
            <kbd className="px-2 py-1 rounded bg-white/10 text-xs font-mono text-slate-300 min-w-[80px] text-center shrink-0">
              {s.key}
            </kbd>
            <span className="text-xs text-slate-400">{s.action}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ShortcutsHelpTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        All keyboard shortcuts across Aeon. Board shortcuts marked with * are customizable in Settings.
      </p>
      <ShortcutGroup title="Board — Customizable *" items={BOARD_CUSTOMIZABLE} />
      <ShortcutGroup title="Board — Fixed" items={BOARD_FIXED} />
      <ShortcutGroup title="Dashboard" items={DASHBOARD} />
      <ShortcutGroup title="Global" items={GLOBAL} />
    </div>
  )
}
