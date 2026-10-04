import type { TelegramMediaRef, TelegramMessageContext, TelegramMomentMessage } from '@/lib/kairos/moment/types'
import { bidsMode, type RapportMode } from './flag'
import { recordMediaBid } from './state'

// A sticker / GIF / caption-less photo from the operator is a small bid: it
// gets exactly one emoji reaction (Bot API setMessageReaction; bots get one
// reaction per message). Any failure is logged — never a text fallback.

export const REACTION_EMOJI = ['👍', '❤', '🔥', '😁', '🤣', '🙏', '👀', '🤗', '🫡', '🎉', '😢', '🤝'] as const
export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

const STICKER_MAP: ReadonlyArray<[RegExp, ReactionEmoji]> = [
  [/😂|🤣|😆|😹|😅/u, '🤣'],
  [/😀|😃|😄|😁|😊|🙂|😉|😎|🤪|😜/u, '😁'],
  [/❤|💕|💖|💗|💘|💞|😍|🥰|😘|♥/u, '❤'],
  [/😢|😭|😞|😔|🥺|😿|💔/u, '😢'],
  [/🎉|🥳|🎊|🍾/u, '🎉'],
  [/🔥|💪|⚡/u, '🔥'],
  [/🙏/u, '🙏'],
  [/🤗/u, '🤗'],
  [/🫡/u, '🫡'],
  [/🤝/u, '🤝'],
  [/👀|🤔|🧐/u, '👀'],
  [/👍|👌|✅/u, '👍'],
]

export type MediaKind = 'sticker' | 'animation' | 'photo'

export function mediaKind(message: Readonly<TelegramMomentMessage>): MediaKind | null {
  if (message.text) return null
  if (message.caption && message.caption.trim()) return null
  if (message.sticker) return 'sticker'
  if (message.animation) return 'animation'
  if (Array.isArray(message.photo) && message.photo.length > 0) return 'photo'
  return null
}

export function reactionFor(kind: MediaKind, media?: TelegramMediaRef): ReactionEmoji {
  const emoji = media?.emoji ?? ''
  for (const [re, out] of STICKER_MAP) if (emoji && re.test(emoji)) return out
  if (kind === 'animation') return '😁'
  if (kind === 'photo') return '👀'
  return '👍'
}

const SEEN_MAX = 200
const seen = new Map<string, true>()

function firstSighting(key: string): boolean {
  if (seen.has(key)) return false
  seen.set(key, true)
  if (seen.size > SEEN_MAX) {
    const oldest = seen.keys().next().value
    if (oldest !== undefined) seen.delete(oldest)
  }
  return true
}

export function resetBidDedupe(): void {
  seen.clear()
}

export interface MediaBidDeps {
  mode?: RapportMode
  react?: (chatId: number | string, messageId: number, emoji: string) => Promise<void>
}

// true = handled (a reaction was attempted or deliberately skipped as a duplicate).
export async function ackMediaBid(ctx: TelegramMessageContext, deps: MediaBidDeps = {}): Promise<boolean> {
  const mode = deps.mode ?? bidsMode()
  if (mode === 'off') return false
  const kind = mediaKind(ctx.message)
  const messageId = ctx.message.message_id
  if (!kind || typeof messageId !== 'number') return false
  const emoji = reactionFor(kind, kind === 'sticker' ? ctx.message.sticker : kind === 'animation' ? ctx.message.animation : undefined)
  if (mode === 'observe') {
    console.info('[kairos:rapport] observe — would react to a media bid', { kind, emoji })
    return false
  }
  const keys = [`m:${ctx.chatId}:${messageId}`, ...(ctx.updateId !== null ? [`u:${ctx.updateId}`] : [])]
  const fresh = keys.map(firstSighting).every(Boolean)
  if (!fresh) return true
  const ref = `tg:${ctx.chatId}:${messageId}`.slice(0, 100)
  let stored = true
  try {
    const data = await import('@/lib/data/kairos-rapport')
    stored = await data.mutateKairosRapport(ctx.userId, (state) => {
      const out = recordMediaBid(state, ref, ctx.now)
      return { state: out.fresh ? out.state : null, result: out.fresh }
    }, ctx.now)
  } catch (err) {
    console.warn('[kairos:rapport] media bid record failed:', err instanceof Error ? err.message : String(err))
  }
  if (!stored) return true
  try {
    const react = deps.react ?? (await import('@/lib/kairos/telegram-api')).setMessageReaction
    await react(ctx.chatId, messageId, emoji)
  } catch (err) {
    console.warn('[kairos:rapport] setMessageReaction failed (no text fallback):', err instanceof Error ? err.message : String(err))
  }
  try {
    const { markKairosSpeaksReplied } = await import('@/lib/data/memories')
    await markKairosSpeaksReplied(ctx.userId, ctx.now)
  } catch (err) {
    console.warn('[kairos:rapport] media bid reply mark failed:', err instanceof Error ? err.message : String(err))
  }
  return true
}
