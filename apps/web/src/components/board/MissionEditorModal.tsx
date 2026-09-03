'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, Rocket, Bot, Save } from 'lucide-react'
import { useShallow } from 'zustand/shallow'
import { cn } from '@/lib/utils/cn'
import { toast } from '@/components/ui/Toast'
import { useBoardStore } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import { listProjectHangarRepos, saveCardMission, spawnSessionFromCard } from '@/lib/actions/hangar'

const OBJECTIVES = [
  { id: 'implement', label: 'Implement' },
  { id: 'bug_fix', label: 'Bug fix' },
  { id: 'recon', label: 'Recon' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'plan', label: 'Plan' },
] as const

const ENGINES = ['copilot', 'claude', 'codex'] as const

interface RepoOption {
  slug: string
  name: string
  allowedEngines: string[]
}

interface HangarDraft {
  objective: string
  repo: string
  agent: string
  model: string
  instruction: string
  autoRun: boolean
}

function draftFromMetadata(metadata: Record<string, unknown> | undefined): HangarDraft {
  const h = (metadata?.hangar ?? {}) as Record<string, unknown>
  return {
    objective: typeof h.objective === 'string' ? h.objective : 'implement',
    repo: typeof h.repo === 'string' ? h.repo : '',
    agent: typeof h.agent === 'string' ? h.agent : 'copilot',
    model: typeof h.model === 'string' ? h.model : '',
    instruction: typeof h.instruction === 'string' ? h.instruction : '',
    // Owner directive: auto-run always re-defaults to OFF for fresh missions.
    autoRun: h.autoRun === true,
  }
}

/**
 * The AI card's mission surface: objective, repo, engine, model, instruction
 * and the auto-run arm switch. Saving writes `metadata.hangar` on the card;
 * "Save & Launch" additionally spawns the queued session the runner claims.
 */
export function MissionEditorModal({ projectId }: { projectId: string }) {
  const { missionEditorTaskId, closeMissionEditor } = useHangarUiStore(
    useShallow((s) => ({ missionEditorTaskId: s.missionEditorTaskId, closeMissionEditor: s.closeMissionEditor }))
  )
  const task = useBoardStore((s) =>
    missionEditorTaskId ? s.tasks.find((t) => t.id === missionEditorTaskId) ?? null : null
  )

  const [draft, setDraft] = useState<HangarDraft | null>(null)
  const [repos, setRepos] = useState<RepoOption[] | null>(null)
  const [busy, setBusy] = useState<'save' | 'launch' | null>(null)

  useEffect(() => {
    if (!missionEditorTaskId) {
      setDraft(null)
      return
    }
    setDraft(draftFromMetadata(task?.metadata))
    // Draft is seeded once per open; live task edits elsewhere must not
    // clobber in-progress typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionEditorTaskId])

  useEffect(() => {
    if (!missionEditorTaskId) return
    let cancelled = false
    listProjectHangarRepos(projectId)
      .then((r) => { if (!cancelled) setRepos(r) })
      .catch(() => { if (!cancelled) setRepos([]) })
    return () => { cancelled = true }
  }, [missionEditorTaskId, projectId])

  const selectedRepo = useMemo(
    () => repos?.find((r) => r.slug === draft?.repo) ?? null,
    [repos, draft?.repo]
  )
  const engineAllowed = (engine: string) =>
    !selectedRepo || selectedRepo.allowedEngines.length === 0 || selectedRepo.allowedEngines.includes(engine)

  if (!missionEditorTaskId || !task || !draft) return null

  const canSave = draft.repo.trim().length > 0 && draft.instruction.trim().length > 0 && busy === null

  const persist = async () => {
    const existing = (task.metadata?.hangar ?? {}) as Record<string, unknown>
    // Direct server write (not the debounced queue): a follow-up launch must
    // read the saved mission, not a stale card.
    const saved = await saveCardMission(projectId, task.id, {
      objective: draft.objective as 'implement',
      repo: draft.repo.trim(),
      agent: draft.agent as 'copilot',
      model: draft.model.trim() || null,
      instruction: draft.instruction.trim(),
      outputMode: 'auto',
      autoRun: draft.autoRun,
    })
    useBoardStore.getState().updateTask(task.id, {
      metadata: { ...task.metadata, hangar: { ...existing, ...saved } },
    })
    return saved
  }

  const handleSave = async () => {
    if (!canSave) return
    setBusy('save')
    try {
      await persist()
      toast('Mission saved')
      closeMissionEditor()
    } catch (err) {
      // Surface the real reason — the model and repo fields have deliberately
      // narrow charsets, and "could not save" hides which one was rejected.
      toast(err instanceof Error ? err.message : 'Could not save mission')
    } finally {
      setBusy(null)
    }
  }

  const handleLaunch = async () => {
    if (!canSave) return
    setBusy('launch')
    try {
      await persist()
      await spawnSessionFromCard(projectId, task.id)
      toast('Mission launched — the runner will claim it shortly')
      closeMissionEditor()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Launch failed')
    } finally {
      setBusy(null)
    }
  }

  const inputClass = cn(
    'w-full px-3 py-2 rounded-lg',
    'bg-white/[0.05] border border-white/[0.1]',
    'text-white placeholder-slate-500 text-sm',
    'focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/50 focus:border-[var(--primary)]/30',
    'transition-all'
  )

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3"
        onClick={closeMissionEditor}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 16 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') closeMissionEditor() }}
          className={cn(
            'w-full max-w-lg p-5 rounded-2xl relative',
            'bg-gradient-to-b from-white/[0.08] to-black/40',
            'backdrop-blur-xl border border-white/[0.08]',
            'max-h-[90vh] overflow-y-auto'
          )}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="w-5 h-5 text-[var(--primary)] flex-shrink-0" />
              <h2 className="text-base font-semibold text-white truncate">AI Mission — {task.name}</h2>
            </div>
            <button
              onClick={closeMissionEditor}
              className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Repository</label>
                <select
                  value={draft.repo}
                  onChange={(e) => setDraft({ ...draft, repo: e.target.value })}
                  className={cn(inputClass, '[color-scheme:dark]')}
                >
                  <option value="">Select repo…</option>
                  {(repos ?? []).map((r) => (
                    <option key={r.slug} value={r.slug}>{r.name} ({r.slug})</option>
                  ))}
                </select>
                {repos !== null && repos.length === 0 && (
                  <p className="text-[10px] text-amber-400/80 mt-1">No repos in this realm&apos;s Hangar registry.</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Objective</label>
                <select
                  value={draft.objective}
                  onChange={(e) => setDraft({ ...draft, objective: e.target.value })}
                  className={cn(inputClass, '[color-scheme:dark]')}
                >
                  {OBJECTIVES.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Engine</label>
                <div className="flex gap-1.5">
                  {ENGINES.map((engine) => (
                    <button
                      key={engine}
                      type="button"
                      disabled={!engineAllowed(engine)}
                      onClick={() => setDraft({ ...draft, agent: engine })}
                      className={cn(
                        'flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize',
                        draft.agent === engine
                          ? 'bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30'
                          : 'bg-white/[0.05] text-slate-400 border-white/[0.08] hover:text-white',
                        !engineAllowed(engine) && 'opacity-40 cursor-not-allowed'
                      )}
                    >
                      {engine}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Model</label>
                <input
                  type="text"
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="engine default"
                  className={inputClass}
                  autoComplete="off"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1.5">Instruction</label>
              <textarea
                value={draft.instruction}
                onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                placeholder="What should the agent do? Paths are relative to the repo root."
                rows={5}
                className={cn(inputClass, 'resize-y min-h-[90px]')}
              />
            </div>

            <button
              type="button"
              onClick={() => setDraft({ ...draft, autoRun: !draft.autoRun })}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.07] transition-all"
              aria-pressed={draft.autoRun}
            >
              <span className="text-left">
                <span className="block text-sm text-white">Auto-run on drop</span>
                <span className="block text-[10px] text-slate-500">Launches when dragged into the board&apos;s launch column. Default off — launching stays a conscious act.</span>
              </span>
              <span
                className={cn(
                  'w-9 h-5 rounded-full relative transition-colors flex-shrink-0 ml-3',
                  draft.autoRun ? 'bg-[var(--primary)]/70' : 'bg-white/15'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                    draft.autoRun ? 'translate-x-[18px]' : 'translate-x-0.5'
                  )}
                />
              </span>
            </button>
          </div>

          <div className="flex gap-2 mt-5 justify-end">
            <button
              onClick={closeMissionEditor}
              className="px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/10 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all',
                'bg-white/[0.06] border-white/[0.12] text-white hover:bg-white/[0.1]',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
            <button
              onClick={handleLaunch}
              disabled={!canSave}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
              style={{
                backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)',
                color: 'var(--primary)',
              }}
            >
              {busy === 'launch' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
              Save &amp; Launch
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
