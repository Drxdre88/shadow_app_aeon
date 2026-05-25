'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowRight } from 'lucide-react'
import { useHasMounted } from '@/lib/utils/useHasMounted'
import { getOwnProjects } from '@/lib/actions/projects'
import { getColumns } from '@/lib/actions/columns'
import { createBoardTask } from '@/lib/actions/board'
import { addLinkToMemory, getMemory } from '@/lib/actions/memories'
import { toast } from '@/components/ui/Toast'
import type { MemoryListItem } from './NoteCard'

type Project = Awaited<ReturnType<typeof getOwnProjects>>[number]
type Column  = Awaited<ReturnType<typeof getColumns>>[number]

type Props = {
  memory: MemoryListItem
  onClose: () => void
  onPromoted: () => void
}

export function PromoteToCardModal({ memory, onClose, onPromoted }: Props) {
  const mounted = useHasMounted()
  const [projects, setProjects] = useState<Project[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [projectId, setProjectId] = useState<string | null>(memory.projectId)
  const [columnId, setColumnId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [colsLoading, setColsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    getOwnProjects()
      .then((rows) => {
        setProjects(rows)
        if (!projectId && rows.length > 0) setProjectId(rows[0].id)
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    setColsLoading(true)
    setColumnId(null)
    getColumns(projectId)
      .then((rows) => {
        setColumns(rows)
        if (rows.length > 0) setColumnId(rows[0].id)
      })
      .catch(() => setColumns([]))
      .finally(() => setColsLoading(false))
  }, [projectId])

  const submit = async () => {
    if (!projectId || !columnId || submitting) return
    setSubmitting(true)
    try {
      // Pull bodyMd from the full memory — listing endpoint returns slim cols only.
      const full = await getMemory(memory.id)
      const description = full?.bodyMd ?? memory.summary ?? memory.title
      const newId = crypto.randomUUID()
      await createBoardTask({
        id: newId,
        projectId,
        name: memory.title.slice(0, 200),
        description: description.slice(0, 4000),
        columnId,
        status: 'todo',
        priority: 'medium',
        color: 'purple',
        onTimeline: false,
        orderIndex: 0,
      })
      await addLinkToMemory(memory.id, {
        type: 'refers_to',
        target: newId,
        targetKind: 'task',
        note: 'promoted to card',
      })
      const proj = projects.find((p) => p.id === projectId)
      const col  = columns.find((c) => c.id === columnId)
      toast(`Promoted to ${proj?.name ?? 'project'} · ${col?.name ?? 'column'}`, { force: true })
      onPromoted()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to promote memory', { force: true })
    } finally {
      setSubmitting(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="promote-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[500] flex items-center justify-center bg-black/55 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: -12, scale: 0.98, opacity: 0 }}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          exit={{ y: -8, scale: 0.98, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-[min(520px,92vw)] rounded-2xl border border-white/[0.08] bg-[rgba(14,12,22,0.95)] shadow-[0_20px_80px_rgba(0,0,0,0.6)] p-5 flex flex-col gap-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-white/70">
              <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--primary)' }} />
              <span className="text-xs font-semibold tracking-[0.2em] uppercase">Promote to Card</span>
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white p-1 rounded-md hover:bg-white/[0.06]">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/30 mb-1">Memory</div>
            <div className="text-sm text-white/85 line-clamp-2">{memory.title}</div>
          </div>

          {loading ? (
            <div className="text-white/40 text-sm py-2">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="text-white/55 text-sm py-2">No projects you own. Create one before promoting.</div>
          ) : (
            <>
              <Field label="Project">
                <select
                  value={projectId ?? ''}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full bg-black/40 border border-white/[0.08] rounded-md px-2 py-1.5 text-sm text-white/85 outline-none focus:border-white/[0.2]"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Column">
                {colsLoading ? (
                  <div className="text-white/40 text-sm">Loading columns…</div>
                ) : columns.length === 0 ? (
                  <div className="text-rose-300 text-xs">No columns available for this project.</div>
                ) : (
                  <select
                    value={columnId ?? ''}
                    onChange={(e) => setColumnId(e.target.value)}
                    className="w-full bg-black/40 border border-white/[0.08] rounded-md px-2 py-1.5 text-sm text-white/85 outline-none focus:border-white/[0.2]"
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.05]">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs text-white/60 hover:text-white hover:bg-white/[0.06]"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting || !projectId || !columnId}
              className="px-3 py-1.5 rounded-md bg-white/[0.10] hover:bg-white/[0.18] text-white/85 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'Promoting…' : 'Promote'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</span>
      {children}
    </div>
  )
}
