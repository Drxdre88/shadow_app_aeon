'use client'

import {
  Trophy,
  BarChart3,
  Clock,
  Filter,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { Section, FeatureCard } from './shared'

const TROPHY_FEATURES = [
  {
    icon: BarChart3,
    title: 'Task Statistics',
    description: 'See total archived tasks, completion trends, and breakdown by column/priority.',
  },
  {
    icon: Clock,
    title: 'Activity Timeline',
    description: 'Chronological view of when tasks were archived. Track your team\'s velocity.',
  },
  {
    icon: Filter,
    title: 'Filtering',
    description: 'Filter archived tasks by label, priority, date range, or search text.',
  },
  {
    icon: RotateCcw,
    title: 'Restore Tasks',
    description: 'Bring archived tasks back to the board. They return to their original column.',
  },
  {
    icon: Sparkles,
    title: 'Glow Preserved',
    description: 'Custom glow colors and labels are preserved when tasks are archived and restored.',
  },
  {
    icon: Trophy,
    title: 'Achievement View',
    description: 'A satisfying collection of everything you\'ve accomplished across the project.',
  },
]

export function TrophyTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-300 leading-relaxed">
        The Vault (Trophy) is your archive of completed work. When you archive tasks from the board,
        they move here with all their data intact - ready to be reviewed or restored.
      </p>

      <Section title="Features">
        <div className="grid grid-cols-2 gap-3">
          {TROPHY_FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Section>

      <Section title="How It Works">
        <ul className="space-y-1.5 text-xs text-slate-400">
          <li>Click the Archive button in the board header to open the vault</li>
          <li>Archived tasks retain all metadata: labels, priority, glow, checklists</li>
          <li>Use the Restore button on any archived task to send it back to the board</li>
          <li>Statistics update in real-time as tasks are archived or restored</li>
        </ul>
      </Section>
    </div>
  )
}
