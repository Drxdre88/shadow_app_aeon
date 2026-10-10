import { loadTodayDigest, recordTodayAfter } from '@/lib/kairos/today'
import { renderTodaySection } from '@/lib/kairos/today-render'
import type { ChatPromptChannel, ChatPromptSurface } from '@/lib/kairos/chat-prompt'
import { scheduleChatCorrectionCheck } from '@/lib/kairos/surprise/owner-correction'
import { hasMomentHook, runOwnerTurnHooks, runReplyHooks, runStripFooters } from '@/lib/kairos/moment'
import { runDetached } from '@/lib/kairos/moment/detached'

// Chat ↔ "today" (spec_one_mind): the write and read points every chat
// channel (web paid, web routine, Telegram paid, Telegram routine) shares,
// so keys and origins stay identical whichever path persisted the turn.
// Key `chat:{thread}:{seq}` is upserted — an edited retry replaces the entry.

export type ChatTodayChannel = 'web' | 'telegram' | 'voice'

// ~1,800 chars of the chat prompt (spec render budget).
export const CHAT_TODAY_MAX_CHARS = 1800

export function chatTodayChannel(surface: ChatPromptSurface | undefined, channel?: ChatPromptChannel): ChatTodayChannel {
  if (channel === 'voice') return 'voice'
  return surface === 'telegram' ? 'telegram' : 'web'
}

// The owner's own turn. Written immediately but never awaited, so it lands
// before the reply without delaying it. With the surprise gate on/observe, a
// turn that reads like a correction is matched against held beliefs after the
// response (owner-correction.ts); otherwise that is a no-op.
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
  scheduleChatCorrectionCheck(userId, threadId, seq, body)
  if (hasMomentHook('ownerTurn')) runDetached(() => runOwnerTurnHooks({ userId, threadId, seq, body, channel, at: new Date() }))
}

// Kairos's reply, as a ≤160-char gist (recordToday clips 'replied'). Started
// immediately, kept alive with after(); never on the reply's critical path.
export async function recordChatReply(
  userId: string,
  threadId: string,
  seq: number,
  content: string,
  channel: ChatTodayChannel,
): Promise<void> {
  // Always stripped (not flag-gated): owner-facing footers never reach a prompt via the today log.
  const text = runStripFooters(content)
  recordTodayAfter(
    userId,
    { key: `chat:${threadId}:${seq}`, channel, type: 'replied', text, ref: { threadId, seq }, covered: 'chat-distill' },
    { kind: 'kairos', via: 'chat' },
  )
  if (hasMomentHook('reply')) runDetached(() => runReplyHooks({ userId, threadId, seq, content, channel, at: new Date() }))
}

// What the owner said / decided on OTHER channels today. This thread's own
// turns are already in the history; coding-session captures are left to
// recency and MCP-use lines are left out so they can't crowd out the owner.
// '' when the feature is off, the window is quiet or the read fails.
export async function loadChatTodaySection(userId: string, threadId: string, maxChars: number = CHAT_TODAY_MAX_CHARS): Promise<string> {
  try {
    const digest = await loadTodayDigest(userId, { excludeThreadId: threadId, excludeTypes: ['captured', 'used'] })
    return renderTodaySection(digest, { maxChars })
  } catch {
    return ''
  }
}
