import { londonDate } from '../daily-message-time'
import { formatDeckAck, parseDeckReply } from './parse'

// Webhook side of the Sunday verdict deck. A message is a deck reply when it
// is ONLY numbered verdicts ("1y 2n 3 skip") and either replies to the stored
// deck message or arrives on the deck's own London day without replying to
// anything else. Owner-only. Data and handlers load only once the text
// parsed, so ordinary chat never touches them. Returns false → other routers
// and chat keep the text.

export interface DeckReplyInput {
  body: string
  replyToMessageId: number | null
  fromId: string | null
  ownerId: string
}

export async function routeVerdictDeckReply(
  userId: string,
  input: DeckReplyInput,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  const tokens = parseDeckReply(input.body)
  if (!tokens) return false
  if (input.fromId !== null && input.fromId !== input.ownerId) return false
  let deck
  try {
    deck = await (await import('@/lib/data/kairos-verdict-deck')).readVerdictDeck(userId)
  } catch (err) {
    console.error('[kairos:verdict-deck] reading the deck failed — handing the text on', err)
    return false
  }
  if (!deck) return false
  const isReply = input.replyToMessageId !== null
  const targetsDeck = isReply ? deck.messageIds.includes(input.replyToMessageId!) : deck.date === londonDate(now)
  if (!targetsDeck) return false
  const { applyDeckTokens } = await import('./apply')
  // A "no" drops or vetoes, so it only counts on an explicit reply to the
  // deck; a stray "2 n" sent that day may have meant something else.
  const safe = isReply ? tokens : tokens.filter((t) => t.verdict !== 'no')
  const refused = isReply ? [] : tokens.filter((t) => t.verdict === 'no').map((t) => ({ n: t.n, status: 'reply_needed' as const }))
  const outcomes = [...(await applyDeckTokens(userId, deck.items, safe, now)), ...refused].sort((a, b) => a.n - b.n)
  // Verdicts are applied: a failed ack must not hand the text on to chat.
  try {
    await send(formatDeckAck(outcomes))
  } catch (err) {
    console.warn('[kairos:verdict-deck] ack failed after applying verdicts', err)
  }
  return true
}
