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

      <Section title="Vorath sorts new cards">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Off by default. The board&apos;s creator switches it on in Edit Project → &quot;Vorath sorts new cards&quot;.</li>
          <li>Vorath looks at new open cards (from the last two days) during his hourly run on your Claude Max plan and suggests labels the board already has, a priority and possible duplicates, each with a reason.</li>
          <li>Suggestions appear in a &quot;Vorath suggests&quot; block on the card. Accept or Dismiss each one (for a duplicate: &quot;Yes, same work&quot;). Nothing changes until you accept.</li>
        </ul>
      </Section>

      <Section title="Hangar missions">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Stalled runs are caught every 15 minutes: a run whose runner went quiet for 30 minutes is marked timed out and its card moves to Tower with the reason. Press Requeue to run it again.</li>
          <li>A mission no runner has picked up shows &quot;Runner offline&quot;. It stays queued and starts when a runner comes back.</li>
          <li>Approve plan first (in the mission settings): the agent writes a plan into the card&apos;s Plan checklist; edit it, then press Approve plan &amp; build, or Revise to send it back.</li>
          <li>When the agent has questions, answer them on the card and press Answer &amp; relaunch.</li>
          <li>Tick the agent&apos;s recommended follow-ups and press Create mission cards to turn them into new cards.</li>
        </ul>
      </Section>

      <Section title="Tips">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Double-click a column header to rename it</li>
          <li>Tasks can have priorities: Critical, High, Medium, Low, None</li>
          <li>Use the layout toggle to switch between compact and comfortable views</li>
          <li>All keyboard shortcuts are in the Keys tab</li>
        </ul>
      </Section>
    </div>
  )
}
