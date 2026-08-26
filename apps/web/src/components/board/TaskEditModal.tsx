'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pin } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { TaskEditContent, type TaskEditFormData } from './TaskEditContent'

type FormData = TaskEditFormData

interface TaskEditModalProps {
  isOpen: boolean
  editingTaskId: string | null
  newTaskStatus: string | null
  formData: FormData
  projectId: string
  onFormChange: (data: FormData) => void
  onSubmit: () => void
  onClose: () => void
  onAddDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onRemoveDependency?: (blockerTaskId: string, blockedTaskId: string) => void
  onLabelCreate?: (label: { id: string; projectId: string; name: string; color: string }) => void | boolean | Promise<void | boolean>
  onLabelUpdate?: (labelId: string, updates: { name?: string; color?: string }) => void
  onLabelDelete?: (labelId: string) => void
  onLabelToggle?: (taskId: string, labelId: string, action: 'add' | 'remove') => void
  onPushToGantt?: (taskId: string) => void
  onDateChange?: (taskId: string, dates: { startDate?: string | null; endDate?: string | null }) => void
  onStatusChange?: (taskId: string, status: string) => void
  onTaskDelete?: (taskId: string) => void
  onBlurPersist?: () => void
  onProgressChange?: (taskId: string, progress: number | null) => void
  /** Pop the open card out as a floating pinned window. */
  onPin?: (taskId: string) => void
}

export function TaskEditModal({
  isOpen,
  editingTaskId,
  newTaskStatus,
  formData,
  projectId,
  onFormChange,
  onSubmit,
  onClose,
  onAddDependency,
  onRemoveDependency,
  onLabelCreate,
  onLabelUpdate,
  onLabelDelete,
  onLabelToggle,
  onPushToGantt,
  onDateChange,
  onStatusChange,
  onTaskDelete,
  onBlurPersist,
  onProgressChange,
  onPin,
}: TaskEditModalProps) {
  const [sizingModalOpen, setSizingModalOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const isDesktop = window.matchMedia('(hover: hover)').matches
    if (isDesktop && !editingTaskId) {
      const timer = setTimeout(() => nameInputRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen, editingTaskId])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The sizing overlay sits on top — let it take the key first.
        if (sizingModalOpen) { setSizingModalOpen(false); return }
        onClose()
        return
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (formData.name.trim()) onSubmit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, onSubmit, formData.name, sizingModalOpen])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'w-full h-full sm:h-auto sm:max-w-lg sm:max-h-[90vh] flex flex-col rounded-none sm:rounded-xl',
              'bg-gradient-to-b from-white/10 to-black/40',
              'backdrop-blur-md border-0 sm:border border-white/10',
              'shadow-none sm:shadow-[0_0_40px_color-mix(in_srgb,var(--primary)_30%,transparent)]'
            )}
          >
            <TaskEditContent
              editingTaskId={editingTaskId}
              formData={formData}
              projectId={projectId}
              onFormChange={onFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
              onAddDependency={onAddDependency}
              onRemoveDependency={onRemoveDependency}
              onLabelCreate={onLabelCreate}
              onLabelUpdate={onLabelUpdate}
              onLabelDelete={onLabelDelete}
              onLabelToggle={onLabelToggle}
              onPushToGantt={onPushToGantt}
              onDateChange={onDateChange}
              onStatusChange={onStatusChange}
              onTaskDelete={onTaskDelete}
              onBlurPersist={onBlurPersist}
              onProgressChange={onProgressChange}
              sizingModalOpen={sizingModalOpen}
              onSizingModalOpenChange={setSizingModalOpen}
              nameInputRef={nameInputRef}
              headerActions={
                editingTaskId && onPin ? (
                  <button
                    onClick={() => onPin(editingTaskId)}
                    title="Pin as floating card"
                    aria-label="Pin as floating card"
                    className={cn(
                      'flex-shrink-0 px-2.5 rounded-lg flex items-center justify-center',
                      'bg-white/5 border border-white/10 hover:bg-white/10',
                      'text-slate-400 hover:text-white transition-all duration-200'
                    )}
                  >
                    <Pin className="w-4 h-4" />
                  </button>
                ) : undefined
              }
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
