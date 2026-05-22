'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Pin, PinOff, Trash2, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { getMemory, updateMemory, deleteMemoryById } from '@/lib/actions/memories'

type MemoryRow = NonNullable<Awaited<ReturnType<typeof getMemory>>>

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

  useEffect(() => {
    if (!memoryId) return
    setLoading(true)
    setBodyOpen(false)
    getMemory(memoryId)
      .then((m) => setData(m))
      .finally(() => setLoading(false))
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
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden text-[11.5px] text-white/75 whitespace-pre-wrap font-sans leading-relaxed bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2"
          >
            {body}
          </motion.pre>
        )}
      </AnimatePresence>
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
