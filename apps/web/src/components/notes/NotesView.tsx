'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { listMemoriesForUser, searchMemories } from '@/lib/actions/memories'
import type { MemoryType, MemorySource } from '@/lib/data/validators'
import { MemorySidePanel } from '@/components/brain/MemorySidePanel'
import { BentoGrid } from './BentoGrid'
import { NoteCard, type MemoryListItem } from './NoteCard'
import { NotesHeader, type FilterState } from './NotesHeader'
import { PromoteToCardModal } from './PromoteToCardModal'

const DEFAULT_LIMIT = 100

function parseFilters(sp: URLSearchParams): FilterState {
  const csv = (k: string) => {
    const v = sp.get(k)
    return v ? v.split(',').filter(Boolean) : []
  }
  return {
    q: sp.get('q') ?? '',
    sources: csv('source'),
    types: csv('type'),
    anchor: (sp.get('anchor') as FilterState['anchor']) ?? 'all',
    pinnedOnly: sp.get('pinned') === '1',
  }
}

export function NotesView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')

  const [filters, setFilters] = useState<FilterState>(() => parseFilters(new URLSearchParams(searchParams.toString())))
  const [memories, setMemories] = useState<MemoryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [promoteTarget, setPromoteTarget] = useState<MemoryListItem | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(focusId)

  // Keep selectedId in sync with URL focus param (so DailyBriefing citations open the panel).
  useEffect(() => {
    setSelectedId(focusId)
  }, [focusId])

  const writeUrl = useCallback((next: FilterState) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.sources.length) sp.set('source', next.sources.join(','))
    if (next.types.length) sp.set('type', next.types.join(','))
    if (next.anchor !== 'all') sp.set('anchor', next.anchor)
    if (next.pinnedOnly) sp.set('pinned', '1')
    if (focusId) sp.set('focus', focusId)
    const qs = sp.toString()
    router.replace(qs ? `/notes?${qs}` : '/notes', { scroll: false })
  }, [router, focusId])

  const onFiltersChange = useCallback((next: FilterState) => {
    setFilters(next)
    writeUrl(next)
  }, [writeUrl])

  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (filters.q.trim()) {
        const res = await searchMemories({
          query: filters.q.trim(),
          type: filters.types.length ? (filters.types as MemoryType[]) : undefined,
          source: filters.sources.length ? (filters.sources as MemorySource[]) : undefined,
          pinnedOnly: filters.pinnedOnly || undefined,
          limit: DEFAULT_LIMIT,
          offset: 0,
        })
        setMemories(res.hits as MemoryListItem[])
      } else {
        const list = await listMemoriesForUser({
          type: filters.types.length ? (filters.types as MemoryType[]) : undefined,
          pinnedOnly: filters.pinnedOnly || undefined,
          limit: DEFAULT_LIMIT,
        })
        const filtered = filters.sources.length
          ? list.filter((m) => filters.sources.includes(m.source))
          : list
        const anchored = filters.anchor === 'anchored'
          ? filtered.filter((m) => m.realmId || m.projectId || m.taskId)
          : filters.anchor === 'unanchored'
          ? filtered.filter((m) => !m.realmId && !m.projectId && !m.taskId)
          : filtered
        setMemories(anchored as MemoryListItem[])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of memories) {
      for (const t of (m.tags ?? []) as string[]) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t)
  }, [memories])

  const openPanel = (id: string) => setSelectedId(id)
  const closePanel = () => setSelectedId(null)

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-black/40 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-white/40 hover:text-white p-1.5 rounded-md hover:bg-white/[0.06]"
            title="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-[11px] uppercase tracking-[0.28em] text-white/50">Notes</span>
          <span className="text-[11px] text-white/30">
            {memories.length} memor{memories.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <Link
          href="/brain"
          className="text-[11px] uppercase tracking-[0.2em] text-white/45 hover:text-white/85 transition-colors"
        >
          Open Cortex →
        </Link>
      </header>

      <NotesHeader value={filters} onChange={onFiltersChange} tagSuggestions={tagSuggestions} />

      <main className="flex-1 relative overflow-y-auto">
        {loading ? (
          <Center>Loading notes…</Center>
        ) : error ? (
          <Center muted>Failed to load: {error}</Center>
        ) : memories.length === 0 ? (
          <Center muted>
            No memories yet — press <Kbd>⌘⇧Space</Kbd> or hit the + button to capture your first thought.
          </Center>
        ) : (
          <BentoGrid>
            {memories.map((m) => (
              <NoteCard
                key={m.id}
                memory={m}
                onOpen={() => openPanel(m.id)}
                onPromote={() => setPromoteTarget(m)}
                onChanged={loadMemories}
              />
            ))}
          </BentoGrid>
        )}

        <MemorySidePanel
          memoryId={selectedId}
          onClose={closePanel}
          onChanged={loadMemories}
        />
      </main>

      {promoteTarget && (
        <PromoteToCardModal
          memory={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onPromoted={() => {
            setPromoteTarget(null)
            loadMemories()
          }}
        />
      )}
    </div>
  )
}

function Center({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`absolute inset-0 flex items-center justify-center text-sm ${muted ? 'text-white/40' : 'text-white/70'}`}>
      <div className="max-w-md text-center">{children}</div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded bg-white/[0.08] border border-white/[0.10] text-[11px] text-white/75 mx-1">
      {children}
    </span>
  )
}
