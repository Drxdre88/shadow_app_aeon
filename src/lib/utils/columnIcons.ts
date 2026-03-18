import {
  ListTodo, Activity, Eye, CheckCircle2, Columns3,
  Zap, Star, Target, Shield, Flag, Clock, Rocket, Flame,
  type LucideIcon,
} from 'lucide-react'

export const COLUMN_ICONS: { id: string; icon: LucideIcon; label: string }[] = [
  { id: 'list-todo', icon: ListTodo, label: 'Todo' },
  { id: 'activity', icon: Activity, label: 'Activity' },
  { id: 'eye', icon: Eye, label: 'Review' },
  { id: 'check-circle', icon: CheckCircle2, label: 'Done' },
  { id: 'columns', icon: Columns3, label: 'Board' },
  { id: 'zap', icon: Zap, label: 'Zap' },
  { id: 'star', icon: Star, label: 'Star' },
  { id: 'target', icon: Target, label: 'Target' },
  { id: 'shield', icon: Shield, label: 'Shield' },
  { id: 'flag', icon: Flag, label: 'Flag' },
  { id: 'clock', icon: Clock, label: 'Clock' },
  { id: 'rocket', icon: Rocket, label: 'Rocket' },
  { id: 'flame', icon: Flame, label: 'Flame' },
]

export const COLUMN_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  COLUMN_ICONS.map((i) => [i.id, i.icon])
)
