'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Eye, GitBranch, RefreshCw } from 'lucide-react'
import { getKairosWatchedOverview, type KairosWatchedOverview } from '@/lib/actions/kairos-brain'
import { setProjectKairosFeed } from '@/lib/actions/projects'
import { addDominionRepoAction } from '@/lib/actions/dominions'
import { Chip, Eyebrow, P, Panel, SegmentedSwitch, tint } from './brainUi'

type Watch = 'off' | 'daily' | 'weekly'
type WatchedProject = KairosWatchedOverview['projects'][number]

const WATCH_OPTIONS: { id: Watch; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
]

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong'
}

export function WatchedView() {
  const [data, setData] = useState<KairosWatchedOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    getKairosWatchedOverview()
      .then((next) => { if (alive) { setData(next); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const setFeed = useCallback(async (project: WatchedProject, next: Watch) => {
    const feed = next === 'off' ? null : next
    const previous = project.feed
    setData((d) => d && { ...d, projects: d.projects.map((p) => (p.id === project.id ? { ...p, feed } : p)) })
    try {
      await setProjectKairosFeed(project.id, feed)
      setError(null)
    } catch (e) {
      setData((d) => d && { ...d, projects: d.projects.map((p) => (p.id === project.id ? { ...p, feed: previous } : p)) })
      setError(errorText(e))
    }
  }, [])

  return (
    <div className="flex flex-col gap-7">
      <P>
        Vorath reads the boards you watch on its own, so you don’t have to summarise your day.{' '}
        <span className="text-white/90">Daily</span> — every card you finish reaches Vorath the same day, plus a
        nightly page. <span className="text-white/90">Weekly</span> — a Monday milestone check.
      </P>

      {error && <ErrorStrip message={error} onRetry={reload} />}

      <section className="flex flex-col gap-3">
        <Eyebrow>Watched boards</Eyebrow>
        {!data ? <ListSkeleton /> : data.projects.length === 0 ? (
          <Empty>No boards of your own yet.</Empty>
        ) : (
          <Panel className="divide-y divide-white/[0.06]">
            {data.projects.map((project) => (
              <BoardRow key={project.id} project={project} onChange={(next) => { void setFeed(project, next) }} />
            ))}
          </Panel>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <Eyebrow>Core repos by area</Eyebrow>
        {!data ? <ListSkeleton /> : (
          <>
            {data.unmappedRepos.length > 0 && (
              <UnmappedRepos repos={data.unmappedRepos} areas={data.areas} onAssigned={reload} onError={setError} />
            )}
            {data.areas.length === 0 ? <Empty>No areas yet.</Empty> : (
              <Panel className="divide-y divide-white/[0.06]">
                {data.areas.map((area) => (
                  <div key={area.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                    <span className="w-36 shrink-0 truncate text-[12.5px] font-medium text-white/90" title={area.name}>{area.name}</span>
                    {area.repos.length === 0
                      ? <span className="text-[11.5px] text-white/35">No repos</span>
                      : area.repos.map((repo) => <Chip key={repo} mono>{repo}</Chip>)}
                  </div>
                ))}
              </Panel>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function BoardRow({ project, onChange }: { project: WatchedProject; onChange: (next: Watch) => void }) {
  const value: Watch = project.feed ?? 'off'
  return (
    <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
      <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: project.feed ? 'var(--primary)' : 'var(--text-dim)' }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium text-white/90" title={project.name}>{project.name}</div>
        {project.areaName && <div className="truncate text-[10.5px] text-white/40">{project.areaName}</div>}
      </div>
      <SegmentedSwitch
        options={WATCH_OPTIONS}
        value={value}
        onChange={onChange}
        layoutId={`kairos-watch-${project.id}`}
        size="sm"
        label={`Vorath watch for ${project.name}`}
      />
    </div>
  )
}

function UnmappedRepos({
  repos, areas, onAssigned, onError,
}: {
  repos: KairosWatchedOverview['unmappedRepos']
  areas: KairosWatchedOverview['areas']
  onAssigned: () => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const assign = async (repo: string, dominionId: string) => {
    if (!dominionId) return
    setBusy(repo)
    try {
      await addDominionRepoAction({ dominionId, repoSlug: repo })
      onAssigned()
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3.5 py-3"
      style={{ borderColor: tint('var(--warning)', 30), background: tint('var(--warning)', 6) }}
    >
      <div className="flex items-center gap-2 text-[12px] text-white/80">
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--warning)' }} />
        Repos from your recent sessions that belong to no area — their work lands in Unassigned.
      </div>
      <ul className="flex flex-col gap-1.5">
        {repos.map((row) => (
          <li key={row.repo} className="flex flex-wrap items-center gap-2 text-[12px]">
            <GitBranch className="w-3.5 h-3.5 text-white/40" />
            <span className="font-mono text-white/85">{row.repo}</span>
            <span className="text-white/40">{row.captures} capture{row.captures === 1 ? '' : 's'}</span>
            {areas.length > 0 && (
              <select
                aria-label={`Assign ${row.repo} to an area`}
                disabled={busy === row.repo}
                defaultValue=""
                onChange={(e) => { void assign(row.repo, e.target.value) }}
                className="ml-auto rounded-md border border-white/[0.10] bg-white/[0.04] px-2 py-1 text-[11px] text-white/80 outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--primary)]"
              >
                <option value="" disabled>Assign to area…</option>
                {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
              </select>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ErrorStrip({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2 text-[11.5px]"
      style={{ borderColor: tint('var(--error)', 30), background: tint('var(--error)', 6) }}
    >
      <span className="text-white/70">{message}</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-medium hover:brightness-125" style={{ color: 'var(--error)' }}>
        <RefreshCw className="w-3 h-3" /> Reload
      </button>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.10] bg-white/[0.02] px-3.5 py-4 text-[12px] text-white/45">
      {children}
    </div>
  )
}

function ListSkeleton() {
  return (
    <Panel className="divide-y divide-white/[0.06]">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 px-3.5 py-3">
          <span className="h-3 w-40 rounded bg-white/[0.08] animate-pulse" />
          <span className="ml-auto h-5 w-36 rounded bg-white/[0.06] animate-pulse" />
        </div>
      ))}
    </Panel>
  )
}
