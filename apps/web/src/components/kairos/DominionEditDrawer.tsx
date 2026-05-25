'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Check, Trash2 } from 'lucide-react'
import {
  inspectDominionAction,
  updateDominionAction,
  createObjectiveAction,
  updateObjectiveAction,
  archiveObjectiveAction,
} from '@/lib/actions/dominions'

// Kairos Phase 1 (C13) — Dominion edit drawer.
//
// Slide-in panel from the right edge. Loads one Dominion's body + objectives.
// Editing vision/mission saves on blur via updateDominionAction. Objectives
// have inline CRUD: add at the bottom, toggle status, archive.

type ObjectiveStatus = 'active' | 'paused' | 'completed' | 'abandoned'

interface Objective {
  id: string
  title: string
  description: string | null
  status: string
  targetDate: Date | string | null
  sortOrder: number
}

interface Briefing {
  id: string
  name: string
  color: string
  vision: string | null
  missionLong: string | null
  objectives: Objective[]
}

interface Props {
  dominionId: string | null
  onClose: () => void
}

const STATUS_CYCLE: Record<string, ObjectiveStatus> = {
  active: 'paused',
  paused: 'completed',
  completed: 'abandoned',
  abandoned: 'active',
}

export function DominionEditDrawer({ dominionId, onClose }: Props) {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const row = await inspectDominionAction(id, 0)
      setBriefing({
        id: row.id,
        name: row.name,
        color: row.color,
        vision: row.vision,
        missionLong: row.missionLong,
        objectives: row.objectives.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          status: o.status,
          targetDate: o.targetDate,
          sortOrder: o.sortOrder,
        })),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Dominion')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (dominionId) load(dominionId)
    else setBriefing(null)
  }, [dominionId, load])

  const saveBody = async (patch: { vision?: string | null; missionLong?: string | null }) => {
    if (!briefing) return
    try {
      const row = await updateDominionAction(briefing.id, patch)
      setBriefing({ ...briefing, vision: row.vision, missionLong: row.missionLong })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const addObjective = async () => {
    if (!briefing) return
    const title = newTitle.trim()
    if (!title) return
    try {
      const row = await createObjectiveAction({ dominionId: briefing.id, title, status: 'active' })
      setBriefing({
        ...briefing,
        objectives: [...briefing.objectives, {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          targetDate: row.targetDate,
          sortOrder: row.sortOrder,
        }],
      })
      setNewTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed')
    }
  }

  const cycleStatus = async (obj: Objective) => {
    if (!briefing) return
    const next = STATUS_CYCLE[obj.status] ?? 'active'
    try {
      const row = await updateObjectiveAction(obj.id, { status: next })
      setBriefing({
        ...briefing,
        objectives: briefing.objectives.map((o) => (o.id === obj.id ? { ...o, status: row.status } : o)),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const renameObjective = async (obj: Objective, title: string) => {
    if (!briefing) return
    const trimmed = title.trim()
    if (!trimmed || trimmed === obj.title) return
    try {
      const row = await updateObjectiveAction(obj.id, { title: trimmed })
      setBriefing({
        ...briefing,
        objectives: briefing.objectives.map((o) => (o.id === obj.id ? { ...o, title: row.title } : o)),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  const archive = async (obj: Objective) => {
    if (!briefing) return
    try {
      await archiveObjectiveAction(obj.id)
      setBriefing({
        ...briefing,
        objectives: briefing.objectives.filter((o) => o.id !== obj.id),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed')
    }
  }

  return (
    <AnimatePresence>
      {dominionId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[180] bg-black/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-[181] w-full sm:w-[460px] bg-[rgba(8,6,18,0.95)] backdrop-blur-xl border-l border-white/[0.07] shadow-2xl flex flex-col"
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    background: `var(--${briefing?.color ?? 'primary'}, var(--primary))`,
                    boxShadow: `0 0 10px var(--${briefing?.color ?? 'primary'}, var(--primary))`,
                  }}
                />
                <h2 className="text-sm font-semibold text-white/95 truncate">
                  {briefing?.name ?? 'Loading…'}
                </h2>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/[0.06]">
                <X className="w-4 h-4" />
              </button>
            </header>

            {error && (
              <div className="px-5 py-2 text-[11px] text-rose-300 border-b border-rose-500/20 bg-rose-500/[0.06]">
                {error}
              </div>
            )}

            {loading && !briefing ? (
              <div className="p-5 text-sm text-white/40">Loading…</div>
            ) : briefing ? (
              <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-6">
                <Field
                  label="Vision"
                  hint="The WHAT — long-form statement of what this Dominion is for."
                  value={briefing.vision ?? ''}
                  onSave={(v) => saveBody({ vision: v.trim() || null })}
                  rows={3}
                />
                <Field
                  label="Mission"
                  hint="The HOW — operating mission."
                  value={briefing.missionLong ?? ''}
                  onSave={(v) => saveBody({ missionLong: v.trim() || null })}
                  rows={5}
                />

                <div>
                  <div className="text-[10px] uppercase tracking-[0.22em] text-white/45 mb-2">Objectives</div>
                  {briefing.objectives.length === 0 ? (
                    <div className="text-[12px] text-white/35 italic mb-3">No objectives yet.</div>
                  ) : (
                    <ul className="flex flex-col gap-1.5 mb-3">
                      {briefing.objectives.map((o) => (
                        <ObjectiveRow
                          key={o.id}
                          objective={o}
                          onCycleStatus={() => cycleStatus(o)}
                          onRename={(title) => renameObjective(o, title)}
                          onArchive={() => archive(o)}
                        />
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addObjective() }}
                      placeholder="New objective…"
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-md px-2.5 py-1.5 text-[12px] text-white/85 placeholder:text-white/30 outline-none focus:border-white/[0.18]"
                    />
                    <button
                      onClick={addObjective}
                      disabled={!newTitle.trim()}
                      className="p-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/70 disabled:opacity-30"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function Field({
  label, hint, value, onSave, rows,
}: {
  label: string
  hint: string
  value: string
  onSave: (v: string) => void
  rows: number
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/45">{label}</span>
      <span className="text-[10px] text-white/30 -mt-1">{hint}</span>
      <textarea
        rows={rows}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== value) onSave(draft) }}
        className="bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-2 text-[12px] text-white/85 outline-none focus:border-white/[0.2] resize-none"
        placeholder={`(no ${label.toLowerCase()} set)`}
      />
    </label>
  )
}

function ObjectiveRow({
  objective, onCycleStatus, onRename, onArchive,
}: {
  objective: Objective
  onCycleStatus: () => void
  onRename: (title: string) => void
  onArchive: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(objective.title)
  useEffect(() => { setDraft(objective.title) }, [objective.title])

  const statusColors: Record<string, string> = {
    active: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    paused: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
    completed: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    abandoned: 'text-white/40 bg-white/[0.04] border-white/10',
  }

  return (
    <li className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] group">
      <button
        onClick={onCycleStatus}
        title={`status: ${objective.status} (click to cycle)`}
        className={`text-[9px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded border ${statusColors[objective.status] ?? statusColors.active}`}
      >
        {objective.status === 'completed' ? <Check className="w-2.5 h-2.5 inline" /> : objective.status.slice(0, 4)}
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onRename(draft); setEditing(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() ; if (e.key === 'Escape') { setDraft(objective.title); setEditing(false) } }}
          className="flex-1 bg-transparent text-[12px] text-white/90 outline-none border-b border-white/[0.2]"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className={`flex-1 text-left text-[12px] truncate ${objective.status === 'abandoned' || objective.status === 'completed' ? 'text-white/45 line-through' : 'text-white/85'}`}
        >
          {objective.title}
        </button>
      )}
      <button
        onClick={onArchive}
        title="Archive"
        className="p-1 rounded text-white/25 hover:text-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </li>
  )
}
