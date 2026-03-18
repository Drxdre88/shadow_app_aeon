'use client'

import {
  GripVertical,
  Columns3,
  Tags,
  GitBranch,
  Filter,
  Archive,
  Palette,
  Plus,
  Keyboard,
  SquareCheck,
} from 'lucide-react'
import { Section, FeatureCard } from './shared'

const BOARD_FEATURES = [
  {
    icon: GripVertical,
    title: 'Drag & Drop',
    description: 'Drag tasks between columns to update status. Reorder within columns by dragging vertically.',
  },
  {
    icon: Columns3,
    title: 'Custom Columns',
    description: 'Create, rename, reorder, and delete columns. Right-click column headers for options.',
  },
  {
    icon: Tags,
    title: 'Labels',
    description: 'Color-coded labels for categorization. Create project-level labels and assign multiple per task.',
  },
  {
    icon: GitBranch,
    title: 'Dependencies',
    description: 'Link tasks with dependency arrows. Toggle visibility with the deps button in the header.',
  },
  {
    icon: Filter,
    title: 'Filters',
    description: 'Filter tasks by label, priority, or search text. Combine filters to narrow down your board.',
  },
  {
    icon: Archive,
    title: 'Vault (Archive)',
    description: 'Archive completed tasks to keep your board clean. Restore anytime from the vault view.',
  },
  {
    icon: Palette,
    title: 'Task Glow Colors',
    description: 'Assign custom glow colors to tasks for visual grouping. Press G while hovering a task.',
  },
  {
    icon: SquareCheck,
    title: 'Checklists',
    description: 'Add checklists to tasks for sub-item tracking. Progress shown on the task card.',
  },
]

const SHORTCUTS = [
  { key: 'T', action: 'Add new task' },
  { key: 'L', action: 'Open label picker' },
  { key: 'G', action: 'Change task glow' },
  { key: 'D', action: 'Toggle due dates' },
  { key: 'Click task', action: 'Open task detail' },
]

export function BoardTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        The Kanban board is your primary workspace for managing tasks. Organize work across
        customizable columns with drag-and-drop, labels, dependencies, and more.
      </p>

      <Section title="Features">
        <div className="grid grid-cols-2 gap-3">
          {BOARD_FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Section>

      <Section title="Keyboard Shortcuts">
        <div className="space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <kbd className="px-2 py-1 rounded bg-white/10 text-xs font-mono text-slate-300 min-w-[80px] text-center">
                {s.key}
              </kbd>
              <span className="text-xs text-slate-400">{s.action}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tips">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Double-click a column header to rename it</li>
          <li>Tasks can have priorities: Critical, High, Medium, Low, None</li>
          <li>Use the layout toggle to switch between compact and comfortable views</li>
          <li>All keyboard shortcuts are customizable in Settings &gt; Shortcuts</li>
        </ul>
      </Section>
    </div>
  )
}
