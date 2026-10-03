import { describe, expect, it } from 'vitest'
import { buildChatMessages, buildChatSystemPrompt, type ChatSystemPromptOptions } from '../chat-prompt'
import { buildDailyMessageUserPrompt, buildDeterministicDailyMessage, type DailyMessageInputs } from '../daily-message-prompt'
import { renderStageBlock } from '../stage'
import { STAGE_BLOCK_BEGIN } from '../stage/render'
import { emptyStageState } from '../stage/select'

// Stage consumers (spec_stage §2): chat puts the block first inside
// "# Grounded context"; the 06:00 prompt carries it in one section. Absent or
// '' → byte-identical prompts.

const NOW = new Date(Date.UTC(2026, 9, 3, 9, 30))
const BLOCK = renderStageBlock({
  ...emptyStageState(),
  updatedAt: NOW.toISOString(),
  coalitions: [{
    id: 'c_00000001', text: 'Billing migration is slipping', cites: [],
    components: { importance: 0.8, surprise: 0.6, goalRelevance: 0.5, need: 0.5 },
    mass: 0.9, massAt: NOW.toISOString(), firstAt: NOW.toISOString(), wins: 0, deepBacked: true, members: [],
  }],
}, { now: NOW }).block

const count = (hay: string, needle: string) => hay.split(needle).length - 1

describe('fixture', () => {
  it('is a real, non-empty stage block', () => {
    expect(BLOCK).toContain(STAGE_BLOCK_BEGIN)
    expect(BLOCK).toContain('I, now: Billing migration is slipping')
  })
})

describe('chat prompt stage section', () => {
  const dominion = { name: 'Hydra', vision: 'Ship it', missionLong: null }
  const opts: ChatSystemPromptOptions = {
    retrieval: { cortex: { id: 'c1', title: 'Cortex', body: 'body' }, archetypes: [], substrate: [] },
    todaySection: 'TODAY',
    conscienceSection: 'CONSCIENCE',
  }

  it('absent or blank → byte-identical', () => {
    for (const dom of [dominion, null]) {
      const base = buildChatSystemPrompt(dom, opts)
      expect(buildChatSystemPrompt(dom, { ...opts, stageSection: '' })).toBe(base)
      expect(buildChatSystemPrompt(dom, { ...opts, stageSection: '  \n' })).toBe(base)
      expect(buildChatSystemPrompt(dom)).toBe(buildChatSystemPrompt(dom, { stageSection: '' }))
    }
  })

  it('renders once, first inside "# Grounded context", before retrieval and today', () => {
    const p = buildChatSystemPrompt(dominion, { ...opts, stageSection: BLOCK })
    expect(count(p, STAGE_BLOCK_BEGIN)).toBe(1)
    const grounded = p.indexOf('# Grounded context')
    const stage = p.indexOf(BLOCK)
    expect(grounded).toBeGreaterThan(-1)
    expect(stage).toBeGreaterThan(grounded)
    expect(stage).toBeLessThan(p.indexOf('## Dominion cortex'))
    expect(stage).toBeLessThan(p.indexOf('TODAY'))
    // Nothing else moves: removing the block (and its blank line) gives the base prompt.
    expect(p.replace(`${BLOCK}\n\n`, '')).toBe(buildChatSystemPrompt(dominion, opts))
  })

  it('a stage block alone still opens the grounded context', () => {
    const p = buildChatSystemPrompt(null, { stageSection: BLOCK })
    expect(p).toContain('# Grounded context')
    expect(p.indexOf(BLOCK)).toBeGreaterThan(p.indexOf('# Grounded context'))
  })

  it('buildChatMessages forwards the section', () => {
    const input = { dominion: null, history: [], userMessage: 'What now?' }
    expect(buildChatMessages(input)[0]?.content).toBe(buildChatSystemPrompt(null))
    expect(buildChatMessages({ ...input, stageSection: BLOCK })[0]?.content).toContain(BLOCK)
  })
})

describe('06:00 message stage section', () => {
  const inputs = (over: Partial<DailyMessageInputs> = {}): DailyMessageInputs => ({
    date: '2026-10-03', isMonday: false, areas: [{ dominion: 'Hydra', headline: 'Export is close' }], aether: null, boardDay: null,
    promotions: null, newBeliefs: null, drift: null, openAsks: null, synthesis: null, mindCompare: null, failed: [], ...over,
  })

  it('absent or blank → byte-identical prompt', () => {
    const base = buildDailyMessageUserPrompt(inputs(), 'CONSCIENCE')
    expect(buildDailyMessageUserPrompt(inputs({ stage: '' }), 'CONSCIENCE')).toBe(base)
  })

  it('renders exactly once, before the conscience block; never in the deterministic text', () => {
    const p = buildDailyMessageUserPrompt(inputs({ stage: BLOCK }), 'CONSCIENCE')
    expect(count(p, STAGE_BLOCK_BEGIN)).toBe(1)
    expect(p.indexOf(BLOCK)).toBeLessThan(p.indexOf('CONSCIENCE'))
    expect(p.replace(`\n\n${BLOCK}`, '')).toBe(buildDailyMessageUserPrompt(inputs(), 'CONSCIENCE'))
    expect(buildDeterministicDailyMessage(inputs({ stage: BLOCK }))).not.toContain(STAGE_BLOCK_BEGIN)
  })
})
