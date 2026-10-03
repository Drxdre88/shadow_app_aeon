import { loadTodayDigest, recordToday, recordTodayAfter } from '@/lib/kairos/today'
import { renderTodaySection } from '@/lib/kairos/today-render'
import type { ChatPromptSurface } from '@/lib/kairos/chat-prompt'

// Chat ↔ "today" (spec_one_mind): the write and read points every chat
// channel (web paid, web routine, Telegram paid, Telegram routine) shares,
// so keys and origins stay identical whichever path persisted the turn.
// Key `chat:{thread}:{seq}` is upserted — an edited retry replaces the entry.

export type ChatTodayChannel = 'web' | 'telegram'

// ~1,800 chars of the chat prompt (spec render budget).
export const CHAT_TODAY_MAX_CHARS = 1800

export function chatTodayChannel(surface: ChatPromptSurface | undefined): ChatTodayChannel {
  return surface === 'telegram' ? 'telegram' : 'web'
}

// The owner's own turn. Deferred (after()), never delays the reply.
export function recordChatOwnerTurn(
  userId: string,
  threadId: string,
  seq: number,
  body: string,
  channel: ChatTodayChannel,
): void {
  recordTodayAfter(
    userId,
    { key: `chat:${threadId}:${seq}`, channel, type: 'said', text: body, ref: { threadId, seq }, covered: 'chat-distill' },
    { kind: 'operator', via: channel },
  )
}

// Kairos's reply, as a ≤160-char gist (recordToday clips 'replied'). Awaited
// by the caller after the reply is persisted; never throws.
export async function recordChatReply(
  userId: string,
  threadId: string,
  seq: number,
  content: string,
  channel: ChatTodayChannel,
): Promise<void> {
  await recordToday(
    userId,
    { key: `chat:${threadId}:${seq}`, channel, type: 'replied', text: content, ref: { threadId, seq }, covered: 'chat-distill' },
    { kind: 'kairos', via: 'chat' },
  )
}

// What the owner said / decided on OTHER channels today. This thread's own
// turns are already in the history; coding-session captures are left to
// recency. '' when the feature is off, the window is quiet or the read fails.
export async function loadChatTodaySection(userId: string, threadId: string): Promise<string> {
  try {
    const digest = await loadTodayDigest(userId, { excludeThreadId: threadId, excludeTypes: ['captured'] })
    return renderTodaySection(digest, { maxChars: CHAT_TODAY_MAX_CHARS })
  } catch {
    return ''
  }
}
