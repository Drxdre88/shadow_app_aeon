import type { ChatPromptMessage, ChatPromptSurface } from '@/lib/kairos/chat-prompt'
import type { ChatTodayChannel } from '@/lib/kairos/chat-today'
import type { SpeakInput } from '@/lib/kairos/speak'
import type { InlineKeyboardButton } from '@/lib/kairos/telegram'

// Wave 4 "moment" seam. Every hook is optional; a lane that implements none is
// a no-op and every surface stays byte-identical. Hooks check their own flag.
// A throwing hook is logged ([kairos:moment]) and skipped; it never fails the
// caller. Lane modules must lazy-import() anything under lib/data.

export type Awaitable<T> = T | Promise<T>

export type MomentLaneName = 'rapport' | 'advise-trust' | 'owner-model' | 'gate' | 'chapters'

// ── speak (deliverKairosSpeak) ───────────────────────────────────────────

export interface SpeakMomentOptions {
  // Promise nudge: lets a force:true send be held by the gate (timing only).
  gate?: boolean
  // Extra Telegram rows placed above the Dismiss / Open row.
  telegramKeyboard?: InlineKeyboardButton[][]
}

export interface SpeakPolicyContext {
  userId: string
  // Message already capped; opsAlert sends never reach a policy.
  input: Readonly<SpeakInput>
  gate: boolean
  awaitingReply: boolean
  replyRate7d: number
  now: Date
}

export interface SpeakBlock { status: 429; reason: string }
export interface SpeakHold { until: string; reason: string }
// Policies can only block or hold, never relax the caps or the forced ceiling.
export interface SpeakPolicyVerdict { block?: SpeakBlock; hold?: SpeakHold }

export interface SpeakDeliveredEvent {
  userId: string
  memoryId: string
  input: Readonly<SpeakInput>
  telegram: boolean
  now: Date
}

// ── chat-today ───────────────────────────────────────────────────────────

export interface OwnerTurnEvent {
  userId: string
  threadId: string
  seq: number
  body: string
  channel: ChatTodayChannel
  at: Date
}

export interface ReplyEvent {
  userId: string
  threadId: string
  seq: number
  content: string
  channel: ChatTodayChannel
  at: Date
}

// ── chat prompt + reply ──────────────────────────────────────────────────

export interface MomentChatContext {
  userId: string
  threadId: string
  dominionId: string | null
  userBody: string
  userSeq: number
  surface: ChatPromptSurface | undefined
  // Prior turns, footers already stripped.
  history: readonly ChatPromptMessage[]
}

export interface MomentChatContribution {
  // Rendered in its own block after the conscience block.
  section?: string
  // Pushed after the cold-read style lines.
  styleLines?: string[]
  // Telegram only: drop the headline/blockquote/closing-question persona.
  brief?: boolean
  // Claims the turn's style: later lanes' styleLines and brief are dropped.
  claim?: boolean
}

export interface MomentChatOptions {
  stageSection?: string
  coldRead?: true
  momentSections?: string[]
  momentStyleLines?: string[]
  briefReply?: true
}

export interface MomentReplyContext {
  userId: string
  threadId: string
  userSeq: number
  userBody: string
  channel: ChatTodayChannel
  finishReason?: string
}

// ── 06:00 daily message ──────────────────────────────────────────────────

export interface MomentDaily {
  // Code-built lines placed before the message body.
  openings?: string[]
  // Model-prompt blocks, rendered after the stage block.
  promptBlocks?: string[]
  // Code-built lines appended after the Horae line.
  tail?: string[]
}

export interface DailyDeliveredEvent {
  userId: string
  date: string
  memoryId: string
  telegram: boolean
  moment: MomentDaily | null
  now: Date
}

// ── Telegram webhook ─────────────────────────────────────────────────────

export interface TelegramMediaRef { file_unique_id?: string; emoji?: string }

export interface TelegramMomentMessage {
  message_id?: number
  text?: string
  caption?: string
  chat?: { id: number | string }
  from?: { id: number | string }
  reply_to_message?: { message_id: number; text?: string }
  sticker?: TelegramMediaRef
  animation?: TelegramMediaRef
  photo?: TelegramMediaRef[]
}

export type TelegramSend = (text: string) => Promise<unknown>

export interface TelegramTextContext {
  userId: string
  chatId: number | string
  body: string
  message: Readonly<TelegramMomentMessage>
  updateId: number | null
  send: TelegramSend
  now: Date
}

export interface TelegramCallbackContext {
  userId: string
  callbackId: string
  data: string
  fromId: string | null
  chatId: number | string
  messageId: number | null
  originalText: string
  now: Date
}

export interface TelegramMessageContext {
  userId: string
  chatId: number | string
  message: Readonly<TelegramMomentMessage>
  updateId: number | null
  now: Date
}

// ── inbox decisions ──────────────────────────────────────────────────────

export interface OwnerDecisionEvent {
  userId: string
  memoryId: string
  verdict: 'accept' | 'dismiss'
  kairosSpeak: boolean
  kind: string | null
}

export interface MomentLane {
  // After the cadence caps pass (never for opsAlert): block (429) or hold.
  speakPolicy?(ctx: SpeakPolicyContext): Awaitable<SpeakPolicyVerdict | null>
  // After a new speak fanned out (inbox + Telegram attempt), not when held.
  speakDelivered?(event: SpeakDeliveredEvent): Awaitable<void>
  // Hourly thinking-sweep, operator only, before the promise nudge. Keys of a
  // non-null result are added to the sweep JSON (core keys always win).
  sweep?(userId: string, now: Date): Awaitable<Record<string, unknown> | null>
  // Every owner chat turn (web/Telegram, paid/routine), detached via after().
  ownerTurn?(event: OwnerTurnEvent): Awaitable<void>
  // Every persisted Kairos chat reply, detached via after().
  reply?(event: ReplyEvent): Awaitable<void>
  // Prompt contribution for one chat turn (all chat paths).
  chatContext?(ctx: MomentChatContext): Awaitable<MomentChatContribution | null>
  // After the cut-short guard; returns the content to persist and send.
  finishReply?(content: string, ctx: MomentReplyContext): Awaitable<string>
  // Pure: removes this lane's footer from a stored message before it is replayed as history.
  stripFooter?(content: string): string
  // 06:00 inputs, gathered with the other daily-message inputs.
  daily?(userId: string, now: Date): Awaitable<MomentDaily | null>
  // After the 06:00 message was delivered (inbox, maybe Telegram).
  dailyDelivered?(event: DailyDeliveredEvent): Awaitable<void>
  // Owner text after the veto-reason router, before chat; true = handled.
  telegramText?(ctx: TelegramTextContext): Awaitable<boolean>
  // Operator-chat callback before dismiss/accept parsing; true = handled (answer it yourself).
  telegramCallback?(ctx: TelegramCallbackContext): Awaitable<boolean>
  // Operator-chat message without text (sticker/animation/photo); true = handled.
  telegramMessage?(ctx: TelegramMessageContext): Awaitable<boolean>
  // After an inbox accept/dismiss succeeded (any surface).
  ownerDecision?(event: OwnerDecisionEvent): Awaitable<void>
}

export interface NamedMomentLane {
  readonly name: MomentLaneName
  readonly lane: MomentLane
}
