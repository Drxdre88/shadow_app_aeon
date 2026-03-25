export type CheckState = 'unchecked' | 'checked' | 'crossed'
export type ChecklistStatus = 'live' | 'blocked' | 'awaiting_dev' | null

export const STATUS_OPTIONS: { value: ChecklistStatus; label: string; color: string; glow: string }[] = [
  { value: 'live', label: 'Live', color: 'text-emerald-400 bg-emerald-500/20 border-emerald-500/30', glow: '0 0 8px rgba(16,185,129,0.4)' },
  { value: 'blocked', label: 'Blocked', color: 'text-red-400 bg-red-500/20 border-red-500/30', glow: '0 0 8px rgba(239,68,68,0.4)' },
  { value: 'awaiting_dev', label: 'Awaiting Dev', color: 'text-amber-400 bg-amber-500/20 border-amber-500/30', glow: '0 0 8px rgba(245,158,11,0.4)' },
  { value: null, label: 'None', color: 'text-slate-400 bg-white/5 border-white/10', glow: 'none' },
]

export interface ChecklistItem {
  id: string
  title: string
  completed: boolean
  state: CheckState
  status: ChecklistStatus
  groupName: string
  startDate?: string
  endDate?: string
}
