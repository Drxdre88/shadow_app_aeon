'use client'

import {
  CalendarRange,
  ArrowLeftRight,
  Clock,
  RefreshCw,
  Link2,
  Eye,
} from 'lucide-react'
import { Section, FeatureCard } from './shared'

const GANTT_FEATURES = [
  {
    icon: CalendarRange,
    title: 'Timeline View',
    description: 'Visualize tasks on a timeline with start/end dates. Drag edges to adjust duration.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Time Scales',
    description: 'Switch between day, week, month, and quarter views for different levels of detail.',
  },
  {
    icon: Clock,
    title: 'Task Bars',
    description: 'Color-coded bars reflect task priority and status. Click a bar to open task details.',
  },
  {
    icon: RefreshCw,
    title: 'Auto Reflow',
    description: 'Automatically space tasks to avoid overlaps. Use the reflow button to reorganize.',
  },
  {
    icon: Link2,
    title: 'Linked to Board',
    description: 'Gantt tasks sync with board tasks. Changes in either view are reflected in both.',
  },
  {
    icon: Eye,
    title: 'View Modes',
    description: 'Toggle between different Gantt views: standard, resource, and milestone views.',
  },
]

export function GanttTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        The Gantt chart provides a timeline view of your project. Tasks from the board are displayed
        as bars on a time axis, with dependencies shown as connecting lines.
      </p>

      <Section title="Features">
        <div className="grid grid-cols-2 gap-3">
          {GANTT_FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Section>

      <Section title="How It Works">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Tasks without dates appear in the unscheduled section</li>
          <li>Drag a task bar horizontally to move it on the timeline</li>
          <li>Drag the left or right edge of a bar to change its start or end date</li>
          <li>Dependencies from the board are shown as arrow lines between bars</li>
          <li>Use the time scale selector to zoom between day, week, month, and quarter views</li>
        </ul>
      </Section>

      <Section title="Tips">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>The Gantt view and board stay in sync - editing a task in one updates the other</li>
          <li>Use Reflow to automatically distribute tasks when the timeline gets cluttered</li>
          <li>Click Reset to restore original task positions after manual rearrangement</li>
        </ul>
      </Section>
    </div>
  )
}
