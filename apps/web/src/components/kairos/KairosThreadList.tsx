'use client'

import type { ChatThreadSummary } from '@/lib/data/kairos-chat'

export function KairosThreadList({
  threads,
  onPick,
  onNew,
}: {
  threads: ChatThreadSummary[]
  onPick: (id: string) => void
  onNew: () => void
}) {
  if (threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-zinc-400">No conversations yet.</p>
        <button
          onClick={onNew}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-500"
          type="button"
        >
          Start one
        </button>
      </div>
    )
  }
  return (
    <div className="flex-1 overflow-y-auto p-2">
      {threads.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          className="w-full rounded-md px-3 py-2 text-left transition hover:bg-zinc-900"
          type="button"
        >
          <div className="truncate text-sm text-zinc-100">{t.title}</div>
          <div className="mt-0.5 truncate text-xs text-zinc-500">
            {t.dominionName ?? 'Unanchored'} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}
          </div>
        </button>
      ))}
    </div>
  )
}
