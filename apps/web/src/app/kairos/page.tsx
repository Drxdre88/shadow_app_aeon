'use client'

import { useState, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Search, Orbit, Network, Table2, Sparkles, EyeOff, Maximize2, Minimize2 } from 'lucide-react'
import type { ComponentType } from 'react'
import { useKairosData } from '@/components/kairos/useKairosData'
import { TrackingRail } from '@/components/kairos/TrackingRail'
import { MemorySidePanel } from '@/components/kairos/MemorySidePanel'
import { KairosLegend } from '@/components/kairos/KairosLegend'
import type { ColorMode } from '@/components/kairos/nodeColor'
import type { BackdropId } from '@/components/kairos/Kairos2D'
import { SkyboxDropdown } from '@/components/skybox/SkyboxDropdown'
import { useKairosStore } from '@/stores/kairosStore'
import { useKairosPrefsStore, type KairosViewMode, type KairosTimeWindow } from '@/stores/kairosPrefsStore'
import { useAetherUi } from '@/components/aether/useAetherUi'

const VIEW_OPTIONS: { id: KairosViewMode; label: string; icon: ComponentType<{ className?: string }>; disabled?: boolean }[] = [
  { id: '3d',     label: '3D',     icon: Orbit },
  { id: '2d',     label: '2D',     icon: Network },
  { id: 'aether', label: 'Aether', icon: Sparkles },
  { id: 'table',  label: 'Table',  icon: Table2, disabled: true },
]

const BACKDROP_OPTIONS: { id: BackdropId; label: string }[] = [
  { id: 'cortex', label: 'Cortex' },
  { id: 'aeon',   label: 'Aeon' },
  { id: 'art',    label: 'Art' },
]

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

const Kairos2D = dynamic(
  () => import('@/components/kairos/Kairos2D').then((m) => m.Kairos2D),
  { ssr: false, loading: () => <Center muted>Booting Kairos 2D…</Center> }
)

const AetherView = dynamic(
  () => import('@/components/aether/AetherView').then((m) => m.AetherView),
  { ssr: false, loading: () => <Center muted>Entering Aether…</Center> }
)

export default function KairosPage() {
  const { graph, loading, error, refresh } = useKairosData()
  const selectedId = useKairosStore((s) => s.selectedMemoryId)
  const setSelectedId = useKairosStore((s) => s.setSelected)
  const view = useKairosPrefsStore((s) => s.view)
  const setView = useKairosPrefsStore((s) => s.setView)
  const colorMode = useKairosPrefsStore((s) => s.colorMode)
  const setColorMode = useKairosPrefsStore((s) => s.setColorMode)
  const skybox = useKairosPrefsStore((s) => s.skybox)
  const setSkybox = useKairosPrefsStore((s) => s.setSkybox)
  const backdrop = useKairosPrefsStore((s) => s.backdrop)
  const setBackdrop = useKairosPrefsStore((s) => s.setBackdrop)
  const timeWindow = useKairosPrefsStore((s) => s.timeWindow)
  const setTimeWindow = useKairosPrefsStore((s) => s.setTimeWindow)
  const zenMode = useKairosPrefsStore((s) => s.zenMode)
  const toggleZen = useKairosPrefsStore((s) => s.toggleZen)
  const setZenMode = useKairosPrefsStore((s) => s.setZenMode)
  const hideUnanchoredInRepo = useKairosPrefsStore((s) => s.hideUnanchoredInRepo)
  const setHideUnanchoredInRepo = useKairosPrefsStore((s) => s.setHideUnanchoredInRepo)
  const legendOpen = useAetherUi((s) => s.legendOpen)
  const toggleLegend = useAetherUi((s) => s.toggleLegend)
  const aetherReaderOpen = useAetherUi((s) => s.readerOpen)
  const toggleReader = useAetherUi((s) => s.toggleReader)
  const railCollapsed = useKairosPrefsStore((s) => s.railCollapsed)
  const toggleRail = useKairosPrefsStore((s) => s.toggleRail)
  const [query, setQuery] = useState('')

  const isGraph = view === '3d' || view === '2d'
  const isAether = view === 'aether'

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
              {VIEW_OPTIONS.map((v) => {
                const Icon = v.icon
                return (
                  <button
                    key={v.id}
                    onClick={() => !v.disabled && setView(v.id)}
                    disabled={v.disabled}
                    title={v.disabled ? `${v.label} (coming soon)` : v.label}
                    className={`px-2 py-1 rounded-md transition-all flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] ${
                      view === v.id
                        ? 'bg-white/[0.12] text-white/90'
                        : v.disabled
                          ? 'text-white/20 cursor-not-allowed'
                          : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{v.label}</span>
                  </button>
                )
              })}
            </div>
            {isGraph && (
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
            )}
            {isAether && (
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                <button
                  onClick={toggleLegend}
                  className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] ${
                    legendOpen ? 'bg-white/[0.12] text-white/90' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  Legend
                </button>
                <button
                  onClick={toggleReader}
                  className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] ${
                    aetherReaderOpen ? 'bg-white/[0.12] text-white/90' : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  Reader
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 flex justify-center">
            {isGraph && (
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
            )}
          </div>

          <div className="flex items-center gap-3">
            {isGraph && colorMode === 'repo' && (
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
            {(view === '3d' || isAether) && (
              <SkyboxDropdown value={skybox} onChange={setSkybox} align="right" />
            )}
            {view === '2d' && (
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                {BACKDROP_OPTIONS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBackdrop(b.id)}
                    className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] ${
                      backdrop === b.id
                        ? 'bg-white/[0.12] text-white/90'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            )}
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
          {isAether ? (
            <AetherView />
          ) : loading ? (
            <Center>Loading Kairos…</Center>
          ) : error ? (
            <Center muted>Failed to load: {error}</Center>
          ) : graph.nodes.length === 0 ? (
            <Center muted>
              No memories yet — use Note in the sidebar or press <Kbd>⌘⇧Space</Kbd> to capture your first thought.
            </Center>
          ) : view === '2d' ? (
            <Kairos2D
              nodes={filteredNodes}
              edges={filteredEdges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              colorMode={colorMode}
              backdrop={backdrop}
            />
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
          {isGraph && !zenMode && !loading && !error && graph.nodes.length > 0 && (
            <KairosLegend nodes={filteredNodes} mode={colorMode} />
          )}
          {isGraph && !zenMode && (
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

        {isGraph && !zenMode && (
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
