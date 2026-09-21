'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import {
  addProjectHangarRepository,
  editProjectHangarRepository,
  type HangarRepositoryRealm,
  type ProjectHangarRepository,
} from '@/lib/actions/hangar-repositories'
import { isSafeRepoSlug } from '@/lib/data/validators'

const ENGINES = ['claude', 'codex', 'copilot'] as const

interface RepositoryDraft {
  realmId: string
  name: string
  slug: string
  gitUrl: string
  defaultBranch: string
  allowedEngines: string[]
}

const emptyDraft = (realmId = ''): RepositoryDraft => ({
  realmId,
  name: '',
  slug: '',
  gitUrl: '',
  defaultBranch: 'main',
  allowedEngines: [],
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function HangarRepositoryForm({
  projectId,
  realms,
  repository,
  onCancel,
  onSaved,
}: {
  projectId: string
  realms: HangarRepositoryRealm[]
  repository: ProjectHangarRepository | null
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<RepositoryDraft>(() => repository ? {
    realmId: repository.realmId,
    name: repository.name,
    slug: repository.slug,
    gitUrl: repository.gitUrl,
    defaultBranch: repository.defaultBranch,
    allowedEngines: repository.allowedEngines,
  } : emptyDraft(realms[0]?.id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slugValid = draft.slug.trim().length > 0 && isSafeRepoSlug(draft.slug.trim())

  const toggleEngine = (engine: string) => {
    setDraft((current) => ({
      ...current,
      allowedEngines: current.allowedEngines.includes(engine)
        ? current.allowedEngines.filter((value) => value !== engine)
        : [...current.allowedEngines, engine],
    }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const values = {
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        gitUrl: draft.gitUrl.trim(),
        defaultBranch: draft.defaultBranch.trim() || 'main',
        allowedEngines: draft.allowedEngines as Array<'claude' | 'codex' | 'copilot'>,
      }
      if (repository) {
        await editProjectHangarRepository(projectId, repository.id, values)
      } else {
        await addProjectHangarRepository(projectId, { realmId: draft.realmId, ...values })
      }
      await onSaved()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-white">{repository ? 'Edit repository' : 'Add repository'}</h3>
        <button type="button" onClick={onCancel} aria-label="Cancel repository edit" className="p-1 text-slate-500 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">
          Realm
          {repository ? (
            <span className="mt-1.5 block rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300">
              {repository.realmName}
            </span>
          ) : (
            <select
              aria-label="Realm"
              required
              value={draft.realmId}
              onChange={(event) => setDraft({ ...draft, realmId: event.target.value })}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
            >
              {realms.map((realm) => <option key={realm.id} value={realm.id}>{realm.name}</option>)}
            </select>
          )}
        </label>
        <label className="text-xs text-slate-400">
          Name
          <input
            required
            maxLength={255}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </label>
        <label className="text-xs text-slate-400">
          Slug
          <input
            required
            maxLength={120}
            value={draft.slug}
            onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
          {!slugValid && draft.slug.length > 0 && (
            <span className="mt-1 block text-[10px] text-red-300">Use letters, numbers, dots, dashes, underscores, or safe path segments.</span>
          )}
        </label>
        <label className="text-xs text-slate-400">
          Default branch
          <input
            maxLength={120}
            value={draft.defaultBranch}
            onChange={(event) => setDraft({ ...draft, defaultBranch: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </label>
        <label className="text-xs text-slate-400 sm:col-span-2">
          Git URL
          <input
            required
            maxLength={500}
            value={draft.gitUrl}
            onChange={(event) => setDraft({ ...draft, gitUrl: event.target.value })}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm text-white outline-none focus:ring-1 focus:ring-[var(--primary)]"
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs text-slate-400">Allowed engines</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={draft.allowedEngines.length === 0}
              onChange={() => setDraft({ ...draft, allowedEngines: [] })}
              className="accent-[var(--primary)]"
            />
            All engines
          </label>
          {ENGINES.map((engine) => (
            <label key={engine} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={draft.allowedEngines.includes(engine)}
                onChange={() => toggleEngine(engine)}
                className="accent-[var(--primary)]"
              />
              {engine}
            </label>
          ))}
        </div>
      </fieldset>

      {!repository && (
        <p className="mt-3 text-[11px] text-amber-200/80">
          The runner must also have this repository configured on its host before missions can use it.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !draft.realmId || !draft.name.trim() || !slugValid || !draft.gitUrl.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {saving ? 'Saving…' : repository ? 'Save changes' : 'Add repository'}
        </button>
      </div>
    </form>
  )
}
