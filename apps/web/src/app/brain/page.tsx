'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { ArrowLeft, Search } from 'lucide-react'
import { useBrainData } from '@/components/brain/useBrainData'
import { CaptureRail } from '@/components/brain/CaptureRail'
import { TrackingRail } from '@/components/brain/TrackingRail'
import { MemorySidePanel } from '@/components/brain/MemorySidePanel'
import { CortexLegend } from '@/components/brain/CortexLegend'
import type { ColorMode } from '@/components/brain/nodeColor'

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'realm',  label: 'Realm' },
  { id: 'repo',   label: 'Repo' },
  { id: 'type',   label: 'Type' },
  { id: 'source', label: 'Source' },
]

const Cortex3D = dynamic(
  () => import('@/components/brain/Cortex3D').then((m) => m.Cortex3D),
  { ssr: false, loading: () => <Center muted>Booting Cortex…</Center> }
)

export default function BrainPage() {
  const { graph, loading, error, refresh } = useBrainData()
  const searchParams = useSearchParams()
  const focusId = searchParams.get('focus')
  const [selectedId, setSelectedId] = useState<string | null>(focusId)
  const [query, setQuery] = useState('')
  const [colorMode, setColorMode] = useState<ColorMode>('repo')

  useEffect(() => {
    if (focusId) setSelectedId(focusId)
  }, [focusId])

  const filteredNodes = query.trim()
    ? graph.nodes.filter((n) => n.title.toLowerCase().includes(query.trim().toLowerCase()))
    : graph.nodes
  const visibleIds = new Set(filteredNodes.map((n) => n.id))
  const filteredEdges = graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))

  return (
    <div className="h-full w-full flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-white/40 hover:text-white p-1.5 rounded-md hover:bg-white/[0.06]"
            title="Back to dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-[11px] uppercase tracking-[0.28em] text-white/50">Cortex</span>
          <span className="text-[11px] text-white/30">
            {graph.nodes.length} memor{graph.nodes.length === 1 ? 'y' : 'ies'} • {graph.edges.length} link{graph.edges.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-white/35">
            <span>Color</span>
            <div className="flex items-center gap-0.5 ml-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {COLOR_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setColorMode(m.id)}
                  className={`px-2 py-1 rounded-md transition-all ${
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
          <div className="flex items-center gap-2 w-[300px]">
            <Search className="w-3.5 h-3.5 text-white/30" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter memories by title…"
              className="flex-1 bg-transparent border-b border-white/[0.08] focus:border-white/[0.2] outline-none text-[12px] text-white/85 placeholder:text-white/30 py-1"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 flex relative">
        <CaptureRail onCaptured={refresh} selectedMemoryId={selectedId} />

        <main className="flex-1 relative">
          {loading ? (
            <Center>Loading brain…</Center>
          ) : error ? (
            <Center muted>Failed to load: {error}</Center>
          ) : graph.nodes.length === 0 ? (
            <Center muted>
              No memories yet — press <Kbd>⌘⇧Space</Kbd> or use the Note button to capture your first thought.
            </Center>
          ) : (
            <Cortex3D
              nodes={filteredNodes}
              edges={filteredEdges}
              selectedId={selectedId}
              onSelect={setSelectedId}
              colorMode={colorMode}
            />
          )}
          {!loading && !error && graph.nodes.length > 0 && (
            <CortexLegend nodes={filteredNodes} mode={colorMode} />
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
