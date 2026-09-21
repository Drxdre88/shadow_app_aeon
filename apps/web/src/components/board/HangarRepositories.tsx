'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Database,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import {
  addProjectHangarRepository,
  editProjectHangarRepository,
  getProjectHangarRepositoryRegistry,
  type ProjectHangarRepository,
  type ProjectHangarRepositoryRegistry,
} from '@/lib/actions/hangar-repositories'
import { HangarRepositoryForm } from './HangarRepositoryForm'

interface HangarRepositoriesProps {
  projectId: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function HangarRepositories({ projectId }: HangarRepositoriesProps) {
  const enabled = useHangarUiStore(
    (state) => state.projectId === projectId && state.config.enabled,
  )
  const [open, setOpen] = useState(false)

  if (!enabled) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Repositories"
        title="Manage repositories available to AI missions"
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-400 transition-all hover:bg-white/5 hover:text-white sm:px-3"
      >
        <Database className="w-4 h-4" />
        <span className="hidden sm:inline">Repositories</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <RepositoryDialog projectId={projectId} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}

function RepositoryDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [registry, setRegistry] = useState<ProjectHangarRepositoryRegistry | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ProjectHangarRepository | 'new' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRegistry(await getProjectHangarRepositoryRegistry(projectId))
    } catch (error) {
      setLoadError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    dialogRef.current?.focus()
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (editing) setEditing(null)
      else onClose()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [editing, onClose])

  const managedRealms = registry?.realms.filter((realm) => realm.canManage) ?? []

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hangar-repositories-title"
        tabIndex={-1}
        className={cn(
          'w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl outline-none',
          'bg-gradient-to-b from-slate-900 to-black border border-white/10',
          'shadow-[0_0_50px_color-mix(in_srgb,var(--primary)_25%,transparent)]',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
          <div>
            <h2 id="hangar-repositories-title" className="flex items-center gap-2 text-base font-semibold text-white">
              <Database className="h-4 w-4 text-[var(--primary)]" />
              Hangar repositories
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Repositories available to mission cards on this board, grouped by realm.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close repositories"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[calc(88vh-78px)] overflow-y-auto p-4 sm:p-6">
          {loading && (
            <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading repositories…
            </div>
          )}

          {!loading && loadError && (
            <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-red-300">Could not load repositories: {loadError}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && registry && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">
                  {registry.repositories.length} {registry.repositories.length === 1 ? 'repository' : 'repositories'} across {registry.realms.length} {registry.realms.length === 1 ? 'realm' : 'realms'}
                </p>
                {managedRealms.length > 0 && !editing && (
                  <button
                    type="button"
                    onClick={() => setEditing('new')}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-3 py-1.5 text-xs font-medium text-[var(--primary)] hover:bg-[var(--primary)]/15"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add repository
                  </button>
                )}
              </div>

              {editing && (
                <HangarRepositoryForm
                  projectId={projectId}
                  realms={managedRealms}
                  repository={editing === 'new' ? null : editing}
                  onCancel={() => setEditing(null)}
                  onSaved={async () => {
                    setEditing(null)
                    await load()
                  }}
                />
              )}

              {registry.realms.length === 0 && (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">
                  This project is not attached to a realm, so it has no repository registry.
                </div>
              )}

              {registry.realms.map((realm) => {
                const repositories = registry.repositories.filter((repo) => repo.realmId === realm.id)
                return (
                  <section key={realm.id} aria-labelledby={`realm-${realm.id}`} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <h3 id={`realm-${realm.id}`} className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        {realm.name}
                      </h3>
                      <span className="text-[10px] text-slate-600">
                        {realm.canManage ? 'Registry editor' : 'Read only'}
                      </span>
                    </div>
                    {repositories.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-slate-500">
                        No repositories registered in this realm.
                      </div>
                    ) : (
                      <div className="grid gap-2 lg:grid-cols-2">
                        {repositories.map((repository) => (
                          <RepositoryCard
                            key={repository.id}
                            projectId={projectId}
                            repository={repository}
                            onEdit={() => setEditing(repository)}
                            onChanged={load}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RepositoryCard({
  projectId,
  repository,
  onEdit,
  onChanged,
}: {
  projectId: string
  repository: ProjectHangarRepository
  onEdit: () => void
  onChanged: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleActive = async () => {
    setSaving(true)
    setError(null)
    try {
      await editProjectHangarRepository(projectId, repository.id, { active: !repository.active })
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className={cn(
      'rounded-xl border p-3',
      repository.active ? 'border-white/10 bg-white/[0.035]' : 'border-white/[0.06] bg-black/20 opacity-70',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', repository.active ? 'bg-emerald-400' : 'bg-slate-600')} />
            <h4 className="truncate text-sm font-medium text-white">{repository.name}</h4>
            <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{repository.slug}</span>
          </div>
          <p className="mt-2 break-all font-mono text-[11px] text-slate-500">{repository.gitUrl}</p>
        </div>
        {repository.canManage && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${repository.name}`}
              className="rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => void toggleActive()}
              disabled={saving}
              aria-label={`${repository.active ? 'Retire' : 'Restore'} ${repository.name}`}
              className="rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : repository.active
                  ? <Archive className="h-3.5 w-3.5" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
        <span className="flex items-center gap-1 rounded-md bg-white/[0.05] px-2 py-1">
          <GitBranch className="h-3 w-3" />
          {repository.defaultBranch}
        </span>
        {(repository.allowedEngines.length > 0 ? repository.allowedEngines : ['All engines']).map((engine) => (
          <span key={engine} className="rounded-md bg-white/[0.05] px-2 py-1">{engine}</span>
        ))}
        <span className={cn(
          'ml-auto rounded-md px-2 py-1',
          repository.active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.05] text-slate-500',
        )}>
          {repository.active ? 'Active' : 'Retired'}
        </span>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    </article>
  )
}
