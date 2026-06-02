'use client'

import type { ChatMessage } from '@/lib/data/kairos-chat'
import {
  buildTitleMap,
  formatReadingLine,
  renderWithCitations,
} from './kairos-citations'

export function KairosMessageStream({
  messages,
  scrollRef,
}: {
  messages: ChatMessage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
      {messages.length === 0 && (
        <div className="text-center text-xs text-zinc-500">Conversation is empty — say something.</div>
      )}
      {messages.map((m) => (
        <KairosMessageBubble key={m.id} message={m} />
      ))}
    </div>
  )
}

function KairosMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const readingLabel = !isUser ? formatReadingLine(message.retrieval) : null
  const titleById = !isUser ? buildTitleMap(message.retrieval) : new Map<string, string>()

  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col items-start'}>
      {readingLabel && (
        <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-zinc-500">
          {readingLabel}
        </div>
      )}
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-purple-600 px-3 py-2 text-sm text-white'
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100'
        }
      >
        <div className="whitespace-pre-wrap break-words">
          {isUser
            ? message.content
            : renderWithCitations(message.content, titleById)}
        </div>
      </div>
    </div>
  )
}
