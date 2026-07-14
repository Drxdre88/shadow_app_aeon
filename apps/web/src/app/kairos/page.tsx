'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Search, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import { useKairosData } from '@/components/kairos/useKairosData'
import { TrackingRail } from '@/components/kairos/TrackingRail'
import { MemorySidePanel } from '@/components/kairos/MemorySidePanel'
import { KairosLegend } from '@/components/kairos/KairosLegend'
import type { ColorMode } from '@/components/kairos/nodeColor'
import { SkyboxDropdown } from '@/components/skybox/SkyboxDropdown'
import { useKairosStore } from '@/stores/kairosStore'
import { useKairosPrefsStore, type KairosTimeWindow } from '@/stores/kairosPrefsStore'

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'dominion', label: 'Dominion' },
  { id: 'repo',     label: 'Repo' },
  { id: 'type',     label: 'Type' },
  { id: 'source',   label: 'Source' },
]

// Lookback window → cutoff in ms. `all` means no floor.
const WINDOW_DAYS: Record<KairosTimeWindow, number | null> = {
  all: null,
  '30d': 30,
  '7d': 7,
  '1d': 1,
}

const Kairos3D = dynamic(
  () => import('@/components/kairos/Kairos3D').then((m) => m.Kairos3D),
  { ssr: false, loading: () => <Center muted>Booting Kairos…</Center> }
)

export default function KairosPage() {
  const { graph, loading, error, refresh } = useKairosData()
  const selectedId = useKairosStore((s) => s.selectedMemoryId)
  const setSelectedId = useKairosStore((s) => s.setSelected)
  const colorMode = useKairosPrefsStore((s) => s.colorMode)
  const setColorMode = useKairosPrefsStore((s) => s.setColorMode)
  const skybox = useKairosPrefsStore((s) => s.skybox)
  const setSkybox = useKairosPrefsStore((s) => s.setSkybox)
  const timeWindow = useKairosPrefsStore((s) => s.timeWindow)
  const setTimeWindow = useKairosPrefsStore((s) => s.setTimeWindow)
  const zenMode = useKairosPrefsStore((s) => s.zenMode)
  const toggleZen = useKairosPrefsStore((s) => s.toggleZen)
  const setZenMode = useKairosPrefsStore((s) => s.setZenMode)
  const hideUnanchoredInRepo = useKairosPrefsStore((s) => s.hideUnanchoredInRepo)
  const setHideUnanchoredInRepo = useKairosPrefsStore((s) => s.setHideUnanchoredInRepo)
  const railCollapsed = useKairosPrefsStore((s) => s.railCollapsed)
  const toggleRail = useKairosPrefsStore((s) => s.toggleRail)
  const [query, setQuery] = useState('')

  // 'z' toggles zen; Esc leaves it. Skip while typing in the filter box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (e.key === 'Escape' && zenMode) { setZenMode(false); return }
      if (e.key.toLowerCase() === 'z' && !typing && !e.metaKey && !e.ctrlKey) toggleZen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zenMode, toggleZen, setZenMode])

  // Derived graph: lookback window (client-side floor on createdAt) → query →
  // repo discipline. Memoised so it doesn't re-run (with per-node Date allocs)
  // on every unrelated re-render. The rail stats use the full set; only the
  // canvas is windowed.
  const { filteredNodes, filteredEdges } = useMemo(() => {
    const days = WINDOW_DAYS[timeWindow]
    const cutoff = days != null ? Date.now() - days * 86_400_000 : null
    const windowed = cutoff != null
      ? graph.nodes.filter((n) => new Date(n.createdAt).getTime() >= cutoff)
      : graph.nodes

    const q = query.trim().toLowerCase()
    const queryFiltered = q
      ? windowed.filter((n) => n.title.toLowerCase().includes(q))
      : windowed

    // Repo-mode: when colouring by repo and hiding unanchored memories, drop
    // nodes with no repo so the view isn't drowned by non-repo memories.
    const nodes = (colorMode === 'repo' && hideUnanchoredInRepo)
      ? queryFiltered.filter((n) => !!n.repo)
      : queryFiltered

    const visibleIds = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    return { filteredNodes: nodes, filteredEdges: edges }
  }, [graph, timeWindow, query, colorMode, hideUnanchoredInRepo])

  return (
    <div className="h-full w-full flex flex-col">
      {!zenMode && (
        <header className="relative z-50 flex items-center px-4 py-3 border-b border-white/[0.06] bg-black/40 backdrop-blur-md gap-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {COLOR_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setColorMode(m.id)}
                  className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] ${
                    colorMode === m.id
                      ? 'bg-white/[0.12] text-white/90'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 flex justify-center">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] w-full max-w-[420px]"
              style={{ boxShadow: 'inset 0 0 16px rgba(0,0,0,0.35)' }}
            >
              <Search className="w-3.5 h-3.5 text-white/35 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter memories…"
                className="flex-1 bg-transparent outline-none text-[12px] text-white/85 placeholder:text-white/35"
              />
              <span className="text-[10px] text-white/30 font-mono shrink-0">⌘K</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {colorMode === 'repo' && (
              <button
                onClick={() => setHideUnanchoredInRepo(!hideUnanchoredInRepo)}
                title={hideUnanchoredInRepo ? 'Showing only memories with a repo. Click to show all.' : 'Showing all memories. Click to hide unanchored.'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] border ${
                  hideUnanchoredInRepo
                    ? 'bg-white/[0.10] text-white/85 border-white/[0.15]'
                    : 'bg-white/[0.02] text-white/40 hover:text-white/70 border-white/[0.06]'
                }`}
              >
                <EyeOff className="w-3 h-3" />
                <span>{hideUnanchoredInRepo ? 'Repo only' : 'All memories'}</span>
              </button>
            )}
            <SkyboxDropdown value={skybox} onChange={setSkybox} align="right" />
            <button
              onClick={toggleZen}
              title="Zen mode — hide all chrome (Z)"
              className="flex items-center justify-center w-7 h-7 rounded-md text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>
      )}

      <div className="flex-1 flex relative">
        <main className="flex-1 relative">
          {loading ? (
            <Center>Loading Kairos…</Center>
          ) : error ? (
            <Center muted>Failed to load: {error}</Center>
          ) : graph.nodes.length === 0 ? (
            <Center muted>
              No memories yet — use Note in the sidebar or press <Kbd>⌘⇧Space</Kbd> to capture your first thought.
            </Center>
          ) : (
            <Kairos3D
              nodes={filteredNodes}
              edges={filteredEdges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              colorMode={colorMode}
              skybox={skybox}
            />
          )}
          {!zenMode && !loading && !error && graph.nodes.length > 0 && (
            <KairosLegend nodes={filteredNodes} mode={colorMode} />
          )}
          {!zenMode && (
            <MemorySidePanel
              memoryId={selectedId}
              onClose={() => setSelectedId(null)}
              onChanged={refresh}
            />
          )}

          {/* Zen mode: only space + nodes; one faint affordance back to chrome. */}
          {zenMode && (
            <button
              onClick={() => setZenMode(false)}
              title="Exit zen mode (Esc)"
              className="absolute top-4 right-4 z-30 flex items-center justify-center w-8 h-8 rounded-md text-white/25 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
          )}
        </main>

        {!zenMode && (
          <TrackingRail
            nodes={graph.nodes}
            onSelect={setSelectedId}
            collapsed={railCollapsed}
            onToggle={toggleRail}
            timeWindow={timeWindow}
            onTimeWindow={setTimeWindow}
            visibleCount={filteredNodes.length}
          />
        )}
      </div>
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
