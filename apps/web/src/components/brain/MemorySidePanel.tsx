'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Pin, PinOff, Trash2, ExternalLink } from 'lucide-react'
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

  useEffect(() => {
    if (!memoryId) return
    setLoading(true)
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
    if (!confirm(`Delete "${data.title}"? This cannot be undone.`)) return
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
          className="absolute top-0 right-0 h-full w-[380px] z-20 bg-[rgba(10,10,15,0.94)] backdrop-blur-xl border-l border-white/[0.08] flex flex-col"
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
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
                <h2 className="text-base font-semibold text-white/90 leading-snug">{data.title}</h2>
                <div className="flex flex-wrap gap-1.5 text-[10px]">
                  <Chip>{data.type}</Chip>
                  <Chip>{data.source}</Chip>
                  {data.pinned && <Chip accent>pinned</Chip>}
                </div>
                {Array.isArray(data.tags) && data.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(data.tags as string[]).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60">#{t}</span>
                    ))}
                  </div>
                )}
                {data.summary && (
                  <p className="text-[12px] text-white/60 italic leading-relaxed">{data.summary}</p>
                )}
                <pre className="text-[12px] text-white/80 whitespace-pre-wrap font-sans leading-relaxed">
                  {data.bodyMd}
                </pre>
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

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 rounded ${accent ? 'bg-amber-500/20 text-amber-200' : 'bg-white/[0.06] text-white/55'}`}>
      {children}
    </span>
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
