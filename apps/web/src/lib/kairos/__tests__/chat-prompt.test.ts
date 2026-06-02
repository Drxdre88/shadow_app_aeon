import { describe, it, expect } from 'vitest'
import {
  buildChatSystemPrompt,
  buildChatMessages,
  MAX_HISTORY_MESSAGES,
  type ChatPromptMessage,
} from '../chat-prompt'

function dom(overrides: Partial<{ name: string; vision: string | null; missionLong: string | null }> = {}) {
  return {
    name: 'AEON',
    vision: 'Fluid board/project app.',
    missionLong: 'Ship closed beta exit by Q3.',
    ...overrides,
  }
}

describe('buildChatSystemPrompt', () => {
  it('includes dominion name, vision, mission, and style guidance', () => {
    const out = buildChatSystemPrompt(dom())
    expect(out).toContain('"AEON" Dominion')
    expect(out).toContain('Fluid board/project app')
    expect(out).toContain('Ship closed beta exit')
    expect(out).toContain('Markdown for replies')
    expect(out).toMatch(/Disagree.*hole/i)
  })

  it('falls back to placeholder when vision or mission absent', () => {
    const out = buildChatSystemPrompt(dom({ vision: null, missionLong: null }))
    expect(out).toContain('(none set yet)')
  })

  it('falls back to placeholder when vision/mission is whitespace-only', () => {
    const out = buildChatSystemPrompt(dom({ vision: '   ', missionLong: '\n\n' }))
    expect(out.match(/\(none set yet\)/g)?.length).toBe(2)
  })
})

describe('buildChatMessages', () => {
  it('shapes [system, ...history, user]', () => {
    const history: ChatPromptMessage[] = [
      { role: 'user', content: 'first thing I said' },
      { role: 'assistant', content: 'first thing Kairos said' },
    ]
    const messages = buildChatMessages({
      dominion: dom(),
      history,
      userMessage: 'a new question',
    })
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('first thing I said')
    expect(messages[2].role).toBe('assistant')
    expect(messages[messages.length - 1].role).toBe('user')
    expect(messages[messages.length - 1].content).toBe('a new question')
    expect(messages.length).toBe(4)
  })

  it('caps history at MAX_HISTORY_MESSAGES, keeping the most recent', () => {
    const history: ChatPromptMessage[] = Array.from({ length: MAX_HISTORY_MESSAGES + 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant' as const,
      content: `msg-${i}`,
    }))
    const messages = buildChatMessages({
      dominion: dom(),
      history,
      userMessage: 'latest',
    })
    // system + capped history + new user
    expect(messages.length).toBe(1 + MAX_HISTORY_MESSAGES + 1)
    // the oldest kept history entry should be the (N - MAX) index, NOT msg-0
    expect(messages[1].content).toBe(`msg-${history.length - MAX_HISTORY_MESSAGES}`)
    // the message just before the new user message is the last history entry
    expect(messages[messages.length - 2].content).toBe(`msg-${history.length - 1}`)
  })

  it('handles empty history cleanly', () => {
    const messages = buildChatMessages({
      dominion: dom(),
      history: [],
      userMessage: 'hello',
    })
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: 'hello' })
  })
})
