import { describe, it, expect } from 'vitest'
import {
  buildChatSystemPrompt,
  buildChatMessages,
  MAX_HISTORY_MESSAGES,
  type ChatPromptMessage,
  type ChatPromptRetrieval,
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

const cortexId = '11111111-1111-4111-8111-111111111111'
const archId   = '22222222-2222-4222-8222-222222222222'
const subId    = '33333333-3333-4333-8333-333333333333'

function retrieval(overrides: Partial<ChatPromptRetrieval> = {}): ChatPromptRetrieval {
  return {
    cortex: { id: cortexId, title: 'AEON cortex 02/06', body: 'vision_anchor: ship beta exit by Q3.\ncurrent_state: Phase 1B shipped.' },
    archetypes: [
      { id: archId, title: 'Kairos brain build-out', body: 'Active synthesis layer. Reflections weighted high.' },
    ],
    substrate: [
      { id: subId, title: 'Reflection — 28/05', body: 'Kairos is becoming the centrepiece, not a side feature.', streamClass: 'reflection' },
    ],
    ...overrides,
  }
}

describe('buildChatSystemPrompt with retrieval (C2)', () => {
  it('omits the grounded block when no retrieval is supplied', () => {
    const out = buildChatSystemPrompt(dom())
    expect(out).not.toContain('Grounded context')
    expect(out).not.toContain('memory-id')
  })

  it('omits the grounded block when retrieval is empty', () => {
    const out = buildChatSystemPrompt(dom(), { cortex: null, archetypes: [], substrate: [] })
    expect(out).not.toContain('Grounded context')
  })

  it('renders cortex + archetype + substrate sections with [[uuid]] headers', () => {
    const out = buildChatSystemPrompt(dom(), retrieval())
    expect(out).toContain('# Grounded context')
    expect(out).toContain('## Dominion cortex')
    expect(out).toContain(`[[${cortexId}]]`)
    expect(out).toContain('## Active archetypes')
    expect(out).toContain(`[[${archId}]]`)
    expect(out).toContain('## Relevant substrate')
    expect(out).toContain(`[[${subId}]]`)
  })

  it('adds the citation style line only when grounding is present', () => {
    const grounded = buildChatSystemPrompt(dom(), retrieval())
    expect(grounded).toMatch(/Cite grounded sources with `\[\[memory-id\]\]`/)
    const bare = buildChatSystemPrompt(dom())
    expect(bare).not.toMatch(/Cite grounded sources/)
  })

  it('labels each substrate entry with its streamClass', () => {
    const out = buildChatSystemPrompt(dom(), retrieval())
    expect(out).toContain('_(reflection)_')
  })

  it('renders archetype-only retrieval without empty cortex/substrate sections', () => {
    const out = buildChatSystemPrompt(dom(), retrieval({ cortex: null, substrate: [] }))
    expect(out).toContain('## Active archetypes')
    expect(out).not.toContain('## Dominion cortex')
    expect(out).not.toContain('## Relevant substrate')
  })

  it('clips overlong bodies with an ellipsis marker', () => {
    const long = 'x'.repeat(5000)
    const out = buildChatSystemPrompt(dom(), retrieval({
      cortex: { id: cortexId, title: 'huge', body: long },
    }))
    expect(out).toContain('…')
    expect(out.length).toBeLessThan(long.length + 2000)
  })
})

describe('buildChatSystemPrompt — unanchored whole-brain (slice 3)', () => {
  it('uses the whole-brain persona and omits vision/mission blocks', () => {
    const out = buildChatSystemPrompt(null)
    expect(out).toContain('whole brain')
    expect(out).not.toContain('Dominion.')
    expect(out).not.toContain('— vision')
    expect(out).not.toContain('— mission')
    expect(out).toContain('Markdown for replies')
  })

  it('labels the cortex block as the Aether self-model', () => {
    const out = buildChatSystemPrompt(null, retrieval())
    expect(out).toContain('## Aether self-model')
    expect(out).not.toContain('## Dominion cortex')
    expect(out).toContain(`[[${cortexId}]]`)
    expect(out).toContain('across the whole brain')
  })

  it('keeps the Dominion cortex label for anchored threads', () => {
    const out = buildChatSystemPrompt(dom(), retrieval())
    expect(out).toContain('## Dominion cortex')
    expect(out).not.toContain('## Aether self-model')
  })
})

describe('buildChatMessages with retrieval (C2)', () => {
  it('passes retrieval into the system prompt and preserves [system, history, user] shape', () => {
    const messages = buildChatMessages({
      dominion: dom(),
      history: [{ role: 'user', content: 'older' }],
      userMessage: 'new',
      retrieval: retrieval(),
    })
    expect(messages.length).toBe(3)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Grounded context')
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'new' })
  })
})
