import { describe, expect, it } from 'vitest'
import { detectBreak, signalsFromEntries, withTrigger, type GateSignals } from '../break'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const LIMITS = { quietMin: 10, chatQuietMin: 15, awayMin: 180 }
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
const none: GateSignals = { lastOwnerAt: null, lastOwnerChatAt: null, lastKairosReplyAt: null, cardClosedAt: null, sessionEndedAt: null }

describe('detectBreak', () => {
  it.each<[string, Partial<GateSignals>, 'send' | 'hold', string]>([
    ['live chat holds', { lastOwnerAt: minAgo(3), lastOwnerChatAt: minAgo(3) }, 'hold', 'chat_live'],
    ['no activity at all sends', {}, 'send', 'idle'],
    ['away ≥ AWAY sends', { lastOwnerAt: minAgo(200) }, 'send', 'idle'],
    ['a fresh card close sends', { lastOwnerAt: minAgo(6), cardClosedAt: minAgo(2) }, 'send', 'card_closed'],
    ['a fresh session end sends', { lastOwnerAt: minAgo(40), sessionEndedAt: minAgo(5) }, 'send', 'session_ended'],
    ['an answered chat gone quiet sends', { lastOwnerAt: minAgo(20), lastOwnerChatAt: minAgo(20), lastKairosReplyAt: minAgo(19) }, 'send', 'chat_ended'],
    ['an unanswered chat gone quiet is just quiet', { lastOwnerAt: minAgo(20), lastOwnerChatAt: minAgo(20) }, 'send', 'quiet'],
    ['quiet after a non-chat act', { lastOwnerAt: minAgo(12) }, 'send', 'quiet'],
    ['recent non-chat activity holds busy', { lastOwnerAt: minAgo(4) }, 'hold', 'busy'],
    ['a card close older than 30 min is no longer an event', { cardClosedAt: minAgo(45), lastOwnerAt: minAgo(50) }, 'send', 'quiet'],
    ['a card close does not cut into live chat', { lastOwnerChatAt: minAgo(2), lastOwnerAt: minAgo(2), cardClosedAt: minAgo(1) }, 'hold', 'chat_live'],
  ])('%s', (_label, partial, action, reason) => {
    expect(detectBreak({ ...none, ...partial }, NOW, LIMITS)).toEqual({ action, reason })
  })
})

describe('signalsFromEntries', () => {
  const at = (m: number) => minAgo(m).toISOString()

  it('reads owner, chat, reply and session signals; ignores MCP use and Kairos speaks', () => {
    const s = signalsFromEntries([
      { at: at(30), channel: 'telegram', type: 'said', speaker: 'owner', relayed: false },
      { at: at(29), channel: 'telegram', type: 'replied', speaker: 'kairos', relayed: false },
      { at: at(2), channel: 'mcp', type: 'used', speaker: 'agent', relayed: false },
      { at: at(1), channel: 'kairos', type: 'spoke', speaker: 'kairos', relayed: false },
      { at: at(10), channel: 'session', type: 'captured', speaker: 'agent', relayed: false },
      { at: at(8), channel: 'inbox', type: 'decided', speaker: 'owner', relayed: false },
    ])
    expect(s.lastOwnerChatAt?.toISOString()).toBe(at(30))
    expect(s.lastKairosReplyAt?.toISOString()).toBe(at(29))
    expect(s.sessionEndedAt?.toISOString()).toBe(at(10))
    expect(s.lastOwnerAt?.toISOString()).toBe(at(8))
  })

  it('a Triad turn relayed for the operator counts as the owner chatting', () => {
    const s = signalsFromEntries([{ at: at(4), channel: 'triad', type: 'said', speaker: 'agent', relayed: true }])
    expect(detectBreak(s, NOW, LIMITS)).toEqual({ action: 'hold', reason: 'chat_live' })
  })

  it('MCP use alone is not busy', () => {
    const s = signalsFromEntries([{ at: at(1), channel: 'mcp', type: 'used', speaker: 'agent', relayed: false }])
    expect(detectBreak(s, NOW, LIMITS)).toEqual({ action: 'send', reason: 'idle' })
  })

  it('an event trigger is the freshest signal', () => {
    const busy = { ...none, lastOwnerAt: minAgo(3) }
    expect(detectBreak(withTrigger(busy, 'card_closed', NOW), NOW, LIMITS)).toEqual({ action: 'send', reason: 'card_closed' })
    expect(detectBreak(withTrigger(busy, 'session_ended', NOW), NOW, LIMITS)).toEqual({ action: 'send', reason: 'session_ended' })
    expect(withTrigger(busy, null, NOW)).toBe(busy)
  })
})
