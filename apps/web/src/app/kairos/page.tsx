'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { Search, Orbit, Network, Table2, EyeOff } from 'lucide-react'
import type { ComponentType } from 'react'
import { useKairosData } from '@/components/kairos/useKairosData'
import { TrackingRail } from '@/components/kairos/TrackingRail'
import { MemorySidePanel } from '@/components/kairos/MemorySidePanel'
import { KairosLegend } from '@/components/kairos/KairosLegend'
import type { ColorMode } from '@/components/kairos/nodeColor'
import type { SkyboxId } from '@/components/kairos/Kairos3D'
import type { BackdropId } from '@/components/kairos/Kairos2D'
import { useKairosStore } from '@/stores/kairosStore'
import { useKairosPrefsStore } from '@/stores/kairosPrefsStore'

type KairosViewMode = '3d' | '2d' | 'table'

const VIEW_OPTIONS: { id: KairosViewMode; label: string; icon: ComponentType<{ className?: string }>; disabled?: boolean }[] = [
  { id: '3d',    label: '3D',    icon: Orbit },
  { id: '2d',    label: '2D',    icon: Network },
  { id: 'table', label: 'Table', icon: Table2, disabled: true },
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

const SKYBOX_OPTIONS: { id: SkyboxId; label: string }[] = [
  { id: 'nebula-4k', label: 'Nebula 4K' },
  { id: 'lunar-4k',  label: 'Lunar 4K' },
  { id: 'lunar-8k',  label: 'Lunar 8K' },
]

const Kairos3D = dynamic(
  () => import('@/components/kairos/Kairos3D').then((m) => m.Kairos3D),
  { ssr: false, loading: () => <Center muted>Booting Kairos…</Center> }
)

const Kairos2D = dynamic(
  () => import('@/components/kairos/Kairos2D').then((m) => m.Kairos2D),
  { ssr: false, loading: () => <Center muted>Booting Kairos 2D…</Center> }
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
  const hideUnanchoredInRepo = useKairosPrefsStore((s) => s.hideUnanchoredInRepo)
  const setHideUnanchoredInRepo = useKairosPrefsStore((s) => s.setHideUnanchoredInRepo)
  const [query, setQuery] = useState('')

  const queryFiltered = query.trim()
    ? graph.nodes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase()))
    : graph.nodes

  // Repo-mode discipline: when the operator is colouring by repo and asked
  // to hide unanchored memories, drop nodes with no repo so the view stops
  // being drowned by everything that isn't repo-attached.
  const filteredNodes = (colorMode === 'repo' && hideUnanchoredInRepo)
    ? queryFiltered.filter((n) => !!n.repo)
    : queryFiltered

  const visibleIds = new Set(filteredNodes.map((n) => n.id))
  const filteredEdges = graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex items-center px-4 py-3 border-b border-white/[0.06] bg-black/40 backdrop-blur-md gap-6">
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
          {view === '3d' && (
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {SKYBOX_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSkybox(s.id)}
                  className={`px-2 py-1 rounded-md transition-all text-[10px] uppercase tracking-[0.2em] ${
                    skybox === s.id
                      ? 'bg-white/[0.12] text-white/90'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
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
        </div>
      </header>

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
          {!loading && !error && graph.nodes.length > 0 && (
            <KairosLegend nodes={filteredNodes} mode={colorMode} />
          )}
          <MemorySidePanel
            memoryId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={refresh}
          />
        </main>

        <TrackingRail nodes={graph.nodes} onSelect={setSelectedId} />
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
