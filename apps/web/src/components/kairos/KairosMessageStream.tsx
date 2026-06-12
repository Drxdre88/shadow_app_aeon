'use client'

import type { ChatMessage } from '@/lib/data/kairos-chat'
import { KairosMarkdown } from '@/components/ui/KairosMarkdown'
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
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        {messages.length === 0 && (
          <div className="text-center text-xs text-zinc-500">Conversation is empty — say something.</div>
        )}
        {messages.map((m) => (
          <KairosMessageBubble key={m.id} message={m} />
        ))}
      </div>
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
            : 'max-w-[85%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-100'
        }
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words text-sm">{message.content}</div>
        ) : (
          // Run text segments (outside **...**) through the citation parser
          // so [[uuid]] tokens become chips while **bold** / **!critical!**
          // get the shared markdown treatment.
          <KairosMarkdown
            markdown={message.content}
            variant="chat"
          />
        )}
        {/* Assistant citations render as a sources strip beneath the message. */}
        {!isUser && titleById.size > 0 && (
          <div className="mt-2 -mb-0.5 flex flex-wrap gap-1">
            {renderWithCitations(message.content, titleById, { sourcesOnly: true })}
          </div>
        )}
      </div>
    </div>
  )
}
