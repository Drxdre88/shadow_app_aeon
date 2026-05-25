'use client'

import { useState } from 'react'
import { Pin, Hand, Globe, Mic, FileDown, Bot, Anchor } from 'lucide-react'
import { motion } from 'framer-motion'
import type { listMemoriesForUser } from '@/lib/actions/memories'
import { updateMemory, deleteMemoryById } from '@/lib/actions/memories'
import { toast } from '@/components/ui/Toast'

type ListResult = Awaited<ReturnType<typeof listMemoriesForUser>>
export type MemoryListItem = ListResult[number] & { snippet?: string }

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  manual: Hand,
  claude: Bot,
  voice:  Mic,
  hook:   FileDown,
  import: Globe,
}

type Props = {
  memory: MemoryListItem
  onOpen: () => void
  onPromote: () => void
  onChanged: () => void
}

export function NoteCard({ memory, onOpen, onPromote, onChanged }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const SourceIcon = SOURCE_ICONS[memory.source] ?? Hand
  const anchored = !!(memory.realmId || memory.projectId || memory.taskId)

  // Tile sizing — pinned spans 2x, long-summary spans wide. Auto-flow:dense fills holes.
  const colSpan = memory.pinned ? 2 : 1
  const rowSpan = memory.pinned ? 2 : (memory.summary && memory.summary.length > 200 ? 2 : 1)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const togglePin = async () => {
    await updateMemory(memory.id, { pinned: !memory.pinned })
    toast(memory.pinned ? 'Unpinned' : 'Pinned', { force: true, duration: 1500 })
    setMenu(null)
    onChanged()
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${memory.title}"?`)) { setMenu(null); return }
    await deleteMemoryById(memory.id)
    toast('Deleted', { force: true, duration: 1500 })
    setMenu(null)
    onChanged()
  }

  return (
    <>
      <motion.button
        layout
        type="button"
        onClick={onOpen}
        onContextMenu={handleContextMenu}
        whileHover={{ y: -2 }}
        className="group relative flex flex-col text-left overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05] hover:border-white/[0.14] backdrop-blur-md transition-all duration-200 p-3"
        style={{
          gridColumn: `span ${colSpan}`,
          gridRow: `span ${rowSpan}`,
          boxShadow: memory.pinned
            ? '0 0 0 1px rgba(245,158,11,0.15), 0 4px 24px rgba(245,158,11,0.05)'
            : undefined,
        }}
      >
        {memory.pinned && (
          <Pin className="absolute top-2 right-2 w-3 h-3 text-amber-300/80" />
        )}

        <h3 className="text-[13px] font-semibold text-white/90 leading-snug line-clamp-2 pr-4">
          {memory.title}
        </h3>

        {memory.summary && (
          <p className="mt-1.5 text-[11.5px] text-white/55 leading-relaxed flex-1 line-clamp-4 overflow-hidden">
            {memory.summary}
          </p>
        )}

        {Array.isArray(memory.tags) && memory.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(memory.tags as string[]).slice(0, 3).map((t) => (
              <span key={t} className="text-[9.5px] px-1.5 py-[1px] rounded bg-white/[0.05] text-white/45">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-white/40">
          <div className="flex items-center gap-1.5">
            <SourceIcon className="w-3 h-3" />
            <span>{formatRelative(memory.createdAt)}</span>
          </div>
          {anchored && (
            <span className="flex items-center gap-1 text-white/50" title="Anchored">
              <Anchor className="w-2.5 h-2.5" />
              <span className="uppercase tracking-wider text-[9px]">{memory.type}</span>
            </span>
          )}
        </div>
      </motion.button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: memory.pinned ? 'Unpin' : 'Pin', onClick: togglePin },
            { label: 'Promote to card…', onClick: () => { setMenu(null); onPromote() } },
            { label: 'Delete', onClick: handleDelete, danger: true },
          ]}
        />
      )}
    </>
  )
}

function ContextMenu({
  x, y, onClose, items,
}: {
  x: number; y: number; onClose: () => void
  items: { label: string; onClick: () => void; danger?: boolean }[]
}) {
  return (
    <>
      <div className="fixed inset-0 z-[300]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        className="fixed z-[301] min-w-[180px] rounded-lg border border-white/[0.08] bg-[rgba(14,12,22,0.96)] backdrop-blur-lg shadow-2xl py-1"
        style={{ top: y, left: x }}
      >
        {items.map((it, i) => (
          <button
            key={i}
            onClick={it.onClick}
            className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors ${
              it.danger
                ? 'text-rose-300 hover:bg-rose-500/10'
                : 'text-white/80 hover:bg-white/[0.06]'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  )
}

function formatRelative(d: Date | string): string {
  const t = new Date(d).getTime()
  const diff = Date.now() - t
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return new Date(d).toLocaleDateString()
}
