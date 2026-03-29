'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Plus, Trash2, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useGanttStore } from '@/lib/store/ganttStore'
import { GanttViewModal } from './GanttViewModal'

interface GanttViewSelectorProps {
  projectId: string
  onViewCreate: (view: { id: string; projectId: string; name: string; groupBy: string; excludedSections: string[]; taskOrder: string; allowWeekends: boolean; allowMultipleRows: boolean; allowOverlap: boolean }) => void
  onViewUpdate?: (view: { id: string; projectId: string; name: string; groupBy: string; excludedSections: string[]; taskOrder: string; allowWeekends: boolean; allowMultipleRows: boolean; allowOverlap: boolean }) => void
  onViewDelete: (viewId: string) => void
}

export function GanttViewSelector({ projectId, onViewCreate, onViewUpdate, onViewDelete }: GanttViewSelectorProps) {
  const { views, activeViewId, setActiveViewId } = useGanttStore()
  const [isOpen, setIsOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null)
  const [editingView, setEditingView] = useState<{ id: string; name: string; groupBy: string; excludedSections?: string[]; taskOrder?: string; allowWeekends?: boolean; allowMultipleRows?: boolean; allowOverlap?: boolean } | undefined>()

  const activeView = views.find((v) => v.id === activeViewId)

  const handleDelete = (viewId: string) => {
    onViewDelete(viewId)
    if (activeViewId === viewId) {
      const remaining = views.filter((v) => v.id !== viewId)
      setActiveViewId(remaining[0]?.id ?? null)
    }
  }

  const handleModalConfirm = (view: { id: string; projectId: string; name: string; groupBy: string; excludedSections: string[]; taskOrder: string; allowWeekends: boolean; allowMultipleRows: boolean; allowOverlap: boolean }) => {
    if (modalMode === 'create') {
      onViewCreate(view)
      setActiveViewId(view.id)
    } else if (modalMode === 'edit') {
      onViewUpdate?.(view)
    }
    setModalMode(null)
    setEditingView(undefined)
    setIsOpen(false)
  }

  const openCreate = () => {
    setModalMode('create')
    setEditingView(undefined)
    setIsOpen(false)
  }

  const openEdit = (view: { id: string; name: string; groupBy: string; filters: Record<string, unknown> }) => {
    setModalMode('edit')
    setEditingView({
      id: view.id,
      name: view.name,
      groupBy: view.groupBy,
      excludedSections: (view.filters?.excludedSections as string[]) ?? [],
      taskOrder: (view.filters?.taskOrder as string) ?? 'column',
      allowWeekends: (view.filters?.allowWeekends as boolean) ?? false,
      allowMultipleRows: (view.filters?.allowMultipleRows as boolean) ?? false,
      allowOverlap: (view.filters?.allowOverlap as boolean) ?? false,
    })
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
          'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300'
        )}
      >
        {activeView?.name ?? 'Select View'}
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              className="absolute left-0 top-full mt-2 z-50 w-64 rounded-xl bg-black/90 backdrop-blur-xl border border-white/10 shadow-xl overflow-hidden"
            >
              {views.length > 0 && (
                <div className="p-1">
                  {views.map((view) => (
                    <div
                      key={view.id}
                      className={cn(
                        'flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors',
                        view.id === activeViewId
                          ? 'bg-cyan-500/20 text-cyan-400'
                          : 'text-slate-300 hover:bg-white/10'
                      )}
                      onClick={() => { setActiveViewId(view.id); setIsOpen(false) }}
                    >
                      <div>
                        <div className="text-sm font-medium">{view.name}</div>
                        <div className="text-xs text-slate-500">{view.groupBy}</div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(view) }}
                          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-cyan-400 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(view.id) }}
                          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-white/10 p-2">
                <button
                  onClick={openCreate}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  New View
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {modalMode && (
        <GanttViewModal
          projectId={projectId}
          mode={modalMode}
          existingView={editingView}
          onConfirm={handleModalConfirm}
          onClose={() => { setModalMode(null); setEditingView(undefined) }}
        />
      )}
    </div>
  )
}
