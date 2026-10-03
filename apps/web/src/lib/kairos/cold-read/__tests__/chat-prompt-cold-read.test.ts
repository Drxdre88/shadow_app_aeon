import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildChatMessages, buildChatSystemPrompt, type ChatSystemPromptOptions } from '@/lib/kairos/chat-prompt'
import { COLD_READ_CHAT_LINES } from '../stance'
import { coldReadEnabled, coldReadMode } from '../flag'

const dominion = { name: 'Hydra', vision: 'Ship it', missionLong: null }
const opts: ChatSystemPromptOptions = {
  surface: 'telegram',
  retrieval: { cortex: { id: 'c1', title: 'Cortex', body: 'body' }, archetypes: [], substrate: [] },
  todaySection: 'TODAY',
  conscienceSection: 'CONSCIENCE',
}

describe('chat prompt with KAIROS_COLD_READ', () => {
  it('is byte-identical when coldRead is absent or false', () => {
    for (const dom of [dominion, null]) {
      const base = buildChatSystemPrompt(dom, opts)
      expect(buildChatSystemPrompt(dom, { ...opts, coldRead: false })).toBe(base)
      expect(base).not.toContain('<stance>')
    }
  })

  it('adds exactly the two cold-read lines, after the disagreement rule', () => {
    const base = buildChatSystemPrompt(dominion, opts)
    const withCold = buildChatSystemPrompt(dominion, { ...opts, coldRead: true })
    const added = withCold.split('\n').filter((l) => !base.split('\n').includes(l))
    expect(added).toEqual(COLD_READ_CHAT_LINES)
    expect(withCold.split('\n').filter((l) => !COLD_READ_CHAT_LINES.includes(l)).join('\n')).toBe(base)
    expect(withCold.indexOf('Diplomacy without disagreement')).toBeLessThan(withCold.indexOf('stranger proposed it'))
  })

  it('buildChatMessages forwards the option', () => {
    const input = { dominion: null, history: [], userMessage: 'Should I?' }
    expect(buildChatMessages(input)[0]?.content).toBe(buildChatSystemPrompt(null))
    expect(buildChatMessages({ ...input, coldRead: true })[0]?.content).toContain('<stance>')
  })
})

describe('coldReadMode', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    [undefined, 'off', false],
    ['', 'off', false],
    ['0', 'off', false],
    ['true', 'off', false],
    ['audit', 'audit', true],
    [' AUDIT ', 'audit', true],
    ['1', 'speak', true],
  ])('KAIROS_COLD_READ=%s → %s', (raw, mode, enabled) => {
    vi.stubEnv('KAIROS_COLD_READ', raw)
    expect(coldReadMode()).toBe(mode)
    expect(coldReadEnabled()).toBe(enabled)
  })
})
