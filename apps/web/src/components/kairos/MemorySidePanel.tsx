'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Pin, PinOff, Trash2, ExternalLink, ChevronDown, ChevronRight, ArrowRight, ArrowLeft as ArrowLeftIcon, Link as LinkIcon, History as HistoryIcon } from 'lucide-react'
import { getMemory, updateMemory, deleteMemoryById, getMemoryNeighbours, getMemoryBeliefTrail } from '@/lib/actions/memories'
import { KairosMarkdown } from '@/components/ui/KairosMarkdown'

type MemoryRow = NonNullable<Awaited<ReturnType<typeof getMemory>>>
type NeighbourBundle = Awaited<ReturnType<typeof getMemoryNeighbours>>
type Neighbour = NeighbourBundle['neighbours'][number]
type BeliefTrail = Awaited<ReturnType<typeof getMemoryBeliefTrail>>

type Props = {
  memoryId: string | null
  onClose: () => void
  onChanged: () => void
}

export function MemorySidePanel({ memoryId, onClose, onChanged }: Props) {
  const [data, setData] = useState<MemoryRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bodyOpen, setBodyOpen] = useState(false)
  const [neighbours, setNeighbours] = useState<NeighbourBundle['neighbours'] | null>(null)
  const [beliefTrail, setBeliefTrail] = useState<BeliefTrail | null>(null)

  useEffect(() => {
    if (!memoryId) return
    setLoading(true)
    setBodyOpen(false)
    setNeighbours(null)
    setBeliefTrail(null)
    getMemory(memoryId)
      .then((m) => setData(m))
      .finally(() => setLoading(false))
    // Neighbours load in the background — failure is non-fatal.
    getMemoryNeighbours(memoryId, { hops: 1, includeReverse: true, limit: 12 })
      .then((res) => setNeighbours(res.neighbours))
      .catch(() => setNeighbours(null))
    // Belief trail loads in the background — failure is non-fatal.
    getMemoryBeliefTrail(memoryId)
      .then((trail) => setBeliefTrail(trail))
      .catch(() => setBeliefTrail(null))
  }, [memoryId])

  const togglePin = async () => {
    if (!data) return
    setBusy(true)
    try {
      const next = await updateMemory(data.id, { pinned: !data.pinned })
      setData(next as MemoryRow)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!data) return
    if (!confirm(`Delete "${displayTitle(data)}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      await deleteMemoryById(data.id)
      onChanged()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {memoryId && (
        <motion.div
          key={memoryId}
          initial={{ x: 380, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 380, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-0 right-0 h-full w-[400px] z-20 bg-[rgba(10,10,15,0.94)] backdrop-blur-xl border-l border-white/[0.08] flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-[10px] uppercase tracking-[0.22em] text-white/40">Memory</span>
            <button onClick={onClose} className="p-1 text-white/40 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {loading || !data ? (
            <div className="p-4 text-white/40 text-sm">Loading…</div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                <h2 className="text-base font-semibold text-white/95 leading-snug">
                  {displayTitle(data)}
                </h2>

                <PillRow data={data} />

                <ExecSummary bullets={toBullets(data.execSummary)} />

                <BodyToggle
                  open={bodyOpen}
                  onToggle={() => setBodyOpen((v) => !v)}
                  body={data.bodyMd}
                />

                <NeighboursPanel
                  neighbours={neighbours}
                  onOpen={(id) => {
                    // Re-seed: simulate switching seed memory by re-fetching.
                    setData(null)
                    setLoading(true)
                    setBodyOpen(false)
                    setNeighbours(null)
                    setBeliefTrail(null)
                    getMemory(id)
                      .then((m) => setData(m))
                      .finally(() => setLoading(false))
                    getMemoryNeighbours(id, { hops: 1, includeReverse: true, limit: 12 })
                      .then((res) => setNeighbours(res.neighbours))
                      .catch(() => setNeighbours(null))
                    getMemoryBeliefTrail(id)
                      .then((trail) => setBeliefTrail(trail))
                      .catch(() => setBeliefTrail(null))
                  }}
                />

                <BeliefTrailPanel trail={beliefTrail} />

                <div className="text-[10px] text-white/30 pt-2 border-t border-white/[0.04]">
                  {new Date(data.createdAt).toLocaleString()}
                </div>
              </div>

              <div className="flex gap-2 p-3 border-t border-white/[0.06]">
                <ActionBtn onClick={togglePin} disabled={busy}>
                  {data.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                  {data.pinned ? 'Unpin' : 'Pin'}
                </ActionBtn>
                <ActionBtn
                  onClick={() => window.open(`/api/v1/memories/${data.id}/export`, '_blank')}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Export
                </ActionBtn>
                <ActionBtn onClick={remove} disabled={busy} variant="danger">
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </ActionBtn>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function displayTitle(m: MemoryRow): string {
  const ai = (m as { aiTitle?: string | null }).aiTitle
  return (ai && ai.trim().length > 0) ? ai : m.title
}

function toBullets(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
}

function PillRow({ data }: { data: MemoryRow }) {
  const tags = Array.isArray(data.tags) ? (data.tags as string[]) : []
  const meta = (data.sourceMetadata ?? {}) as { repo?: string | null }
  const repo = typeof meta.repo === 'string' ? meta.repo : null
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]">
      <Pill variant="type">{data.type}</Pill>
      <Pill variant="source">{data.source}</Pill>
      {data.pinned && <Pill variant="accent">pinned</Pill>}
      {repo && <Pill variant="repo">{repo}</Pill>}
      {tags.map((t) => (
        <Pill key={t} variant="tag">#{t}</Pill>
      ))}
    </div>
  )
}

function Pill({
  children, variant,
}: {
  children: React.ReactNode
  variant: 'type' | 'source' | 'accent' | 'repo' | 'tag'
}) {
  const styles: Record<string, string> = {
    type:   'bg-sky-500/15 text-sky-200 border-sky-500/25',
    source: 'bg-violet-500/15 text-violet-200 border-violet-500/25',
    accent: 'bg-amber-500/20 text-amber-200 border-amber-500/30',
    repo:   'bg-emerald-500/15 text-emerald-200 border-emerald-500/25',
    tag:    'bg-white/[0.04] text-white/55 border-white/[0.06]',
  }
  return (
    <span
      className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-[0.06em] font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  )
}

function ExecSummary({ bullets }: { bullets: string[] }) {
  if (bullets.length === 0) {
    return (
      <div
        className="px-3 py-3 rounded-lg text-[11px] text-white/40 italic leading-relaxed border border-dashed border-white/[0.06]"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        Summary not generated yet. Run regenerate_summaries from MCP, or it will populate automatically the next time the backfill cron runs.
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5 text-[12px] text-white/85 leading-relaxed">
      {bullets.map((b, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-white/30 shrink-0 select-none">•</span>
          <span>{b}</span>
        </li>
      ))}
    </ul>
  )
}

function BodyToggle({ open, onToggle, body }: { open: boolean; onToggle: () => void; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-white/45 hover:text-white/80 transition-colors w-fit"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {open ? 'Hide full memory' : 'Show full memory'}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2"
          >
            <KairosMarkdown markdown={body} variant="briefing" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function NeighboursPanel({
  neighbours,
  onOpen,
}: {
  neighbours: Neighbour[] | null
  onOpen: (id: string) => void
}) {
  if (!neighbours) return null

  if (neighbours.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] uppercase tracking-[0.22em] text-white/40 inline-flex items-center gap-1.5">
          <LinkIcon className="w-3 h-3" /> Related
        </span>
        <div
          className="px-3 py-2 rounded-lg text-[11px] text-white/35 italic leading-relaxed border border-dashed border-white/[0.05]"
          style={{ background: 'rgba(255,255,255,0.015)' }}
        >
          No linked memories yet. Add a link from MCP or the body to surface neighbours here.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/40 inline-flex items-center gap-1.5">
        <LinkIcon className="w-3 h-3" /> Related <span className="text-white/25 normal-case tracking-normal">· {neighbours.length}</span>
      </span>
      <ul className="flex flex-col gap-1">
        {neighbours.map((n) => (
          <li key={`${n.direction}:${n.id}`}>
            <button
              onClick={() => onOpen(n.id)}
              className="group w-full text-left px-2.5 py-1.5 rounded-lg border border-white/[0.05] bg-white/[0.015] hover:bg-white/[0.05] hover:border-white/[0.10] transition-all"
            >
              <div className="flex items-center gap-1.5 text-[10px] text-white/40 mb-0.5">
                {n.direction === 'outgoing' ? (
                  <ArrowRight className="w-2.5 h-2.5" />
                ) : (
                  <ArrowLeftIcon className="w-2.5 h-2.5" />
                )}
                <span className="uppercase tracking-[0.12em]">{n.edgeType ?? 'relates'}</span>
                <span className="text-white/25 ml-auto">{n.type}</span>
              </div>
              <div className="text-[11.5px] text-white/85 leading-snug line-clamp-2 group-hover:text-white">
                {n.title}
              </div>
              {n.summary && (
                <div className="text-[10.5px] text-white/45 line-clamp-1 mt-0.5">
                  {n.summary}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BeliefTrailPanel({ trail }: { trail: BeliefTrail | null }) {
  if (!trail || trail.length <= 1) return null

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.22em] text-white/40 inline-flex items-center gap-1.5">
        <HistoryIcon className="w-3 h-3" /> History <span className="text-white/25 normal-case tracking-normal">· {trail.length}</span>
      </span>
      <ul className="flex flex-col gap-1">
        {trail.map((node) => (
          <li
            key={node.id}
            className="px-2.5 py-1.5 rounded-lg border border-white/[0.05] bg-white/[0.015]"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-white/40 mb-0.5">
              {node.isTarget && <span className="uppercase tracking-[0.12em] text-white/50">viewing</span>}
              {!node.isCurrent && node.invalidFrom && (
                <span className="ml-auto normal-case tracking-normal">
                  superseded {new Date(node.invalidFrom).toLocaleDateString()}
                </span>
              )}
            </div>
            <div
              className={`text-[11.5px] leading-snug line-clamp-2 ${
                node.isCurrent ? 'text-white/85' : 'text-white/45 line-through decoration-white/15'
              }`}
            >
              {node.aiTitle ?? node.title}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ActionBtn({
  children, onClick, disabled, variant,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'danger'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all disabled:opacity-30 ${
        variant === 'danger'
          ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300'
          : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/75'
      }`}
    >
      {children}
    </button>
  )
}
