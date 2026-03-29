'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useThemeStore, type ProjectViewMode, type ProjectSortMode, type BoardLayout } from '@/stores/themeStore'
import { cn } from '@/lib/utils/cn'

function OptionCard<T extends string>({
  id,
  label,
  desc,
  active,
  onClick,
}: {
  id: T
  label: string
  desc: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      key={id}
      onClick={onClick}
      className={cn(
        'flex-1 p-2.5 rounded-xl border transition-all text-left',
        active
          ? 'border-[var(--primary)]/50 bg-[var(--primary)]/10'
          : 'border-white/[0.1] bg-white/[0.03] hover:bg-white/[0.06]'
      )}
    >
      <span className={cn('text-xs font-medium block mb-0.5', active ? 'text-white' : 'text-slate-300')}>{label}</span>
      <p className="text-[10px] text-slate-500 leading-tight">{desc}</p>
    </button>
  )
}

function DefaultViewSetting() {
  const { defaultProjectView, setDefaultProjectView } = useThemeStore()

  const options: { id: ProjectViewMode; label: string; desc: string }[] = [
    { id: 'grid', label: 'Grid', desc: 'Card grid grouped by project group' },
    { id: 'tree', label: 'Tree', desc: 'Hierarchical tree with nested groups' },
    { id: 'space', label: 'Space', desc: 'Orbital space view with planets' },
  ]

  return (
    <div className="space-y-2 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Default View</h4>
      <p className="text-[10px] text-slate-600">Starting view mode when opening the projects dashboard</p>
      <div className="flex gap-2">
        {options.map(({ id, label, desc }) => (
          <OptionCard key={id} id={id} label={label} desc={desc} active={defaultProjectView === id} onClick={() => setDefaultProjectView(id)} />
        ))}
      </div>
    </div>
  )
}

function DefaultLayoutSetting() {
  const { boardLayout, setBoardLayout } = useThemeStore()

  const options: { id: BoardLayout; label: string; desc: string }[] = [
    { id: 'scroll', label: 'Scroll', desc: 'Columns scroll horizontally' },
    { id: 'grid', label: 'Wrap', desc: 'Columns wrap to fill width' },
  ]

  return (
    <div className="space-y-2 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Default Layout</h4>
      <p className="text-[10px] text-slate-600">Default layout mode for the grid project view</p>
      <div className="flex gap-2">
        {options.map(({ id, label, desc }) => (
          <OptionCard key={id} id={id} label={label} desc={desc} active={boardLayout === id} onClick={() => setBoardLayout(id)} />
        ))}
      </div>
    </div>
  )
}

function DefaultSortSetting() {
  const { defaultProjectSort, setDefaultProjectSort } = useThemeStore()

  const options: { id: ProjectSortMode; label: string; desc: string }[] = [
    { id: 'alphabetical', label: 'Alphabetical', desc: 'A–Z within each group' },
    { id: 'custom', label: 'Custom', desc: 'Manual drag order preserved' },
  ]

  return (
    <div className="space-y-2 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Default Sort</h4>
      <p className="text-[10px] text-slate-600">Default project ordering within groups</p>
      <div className="flex gap-2">
        {options.map(({ id, label, desc }) => (
          <OptionCard key={id} id={id} label={label} desc={desc} active={defaultProjectSort === id} onClick={() => setDefaultProjectSort(id)} />
        ))}
      </div>
    </div>
  )
}

function ExportDataSetting() {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/export')
      if (!res.ok) throw new Error()
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aeon-export-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch {} finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-2 max-w-md">
      <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider">Data Export</h4>
      <p className="text-[10px] text-slate-600">Download all your projects, tasks, and data as JSON</p>
      <button
        onClick={handleExport}
        disabled={exporting}
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
          'bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1]',
          'text-slate-300 hover:text-white disabled:opacity-50'
        )}
      >
        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {exporting ? 'Exporting...' : 'Export All Data'}
      </button>
    </div>
  )
}

export function DashboardTab() {
  return (
    <div className="space-y-6">
      <DefaultViewSetting />
      <DefaultLayoutSetting />
      <DefaultSortSetting />
      <ExportDataSetting />
    </div>
  )
}
