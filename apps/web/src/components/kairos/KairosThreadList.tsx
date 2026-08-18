'use client'

import { Plus } from 'lucide-react'
import type { ChatThreadSummary } from '@/lib/data/kairos-chat'

// Always-visible left history rail (ChatGPT/Claude pattern). New-chat button
// up top, then the conversation list with an active accent bar. Width is fixed
// so the conversation pane flexes to fill the rest.
export function KairosThreadList({
  threads,
  activeId,
  onPick,
  onNew,
}: {
  threads: ChatThreadSummary[]
  activeId: string | null
  onPick: (id: string) => void
  onNew: () => void
}) {
  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-white/[0.06] bg-black/40">
      <div className="p-3">
        <button
          onClick={onNew}
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-white transition hover:brightness-110"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--primary) 90%, transparent)',
            textShadow: '0 0 8px color-mix(in srgb, var(--primary) 50%, transparent)',
          }}
        >
          <Plus className="h-4 w-4" />
          New chat
        </button>
      </div>

      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-white/[0.12] to-transparent" />

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-zinc-500">
            No conversations yet.
          </p>
        ) : (
          threads.map((t) => {
            const active = t.id === activeId
            return (
              <button
                key={t.id}
                onClick={() => onPick(t.id)}
                type="button"
                className={`relative mb-0.5 w-full rounded-lg px-3 py-2 text-left transition ${
                  active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                    style={{
                      backgroundColor: 'var(--primary)',
                      boxShadow: '0 0 6px color-mix(in srgb, var(--primary) 70%, transparent)',
                    }}
                  />
                )}
                <div className={`truncate text-[12.5px] ${active ? 'font-medium text-white' : 'text-zinc-200'}`}>
                  {t.title}
                </div>
                <div className="mt-0.5 truncate text-[10.5px] text-zinc-500">
                  {t.dominionName ?? 'Whole brain'} · {t.messageCount} msg{t.messageCount === 1 ? '' : 's'}
                </div>
              </button>
            )
          })
        )}
      </div>
    </aside>
  )
}
