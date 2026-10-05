import { describe, expect, it } from 'vitest'
import { opWords, originWords, recheckWords, sensitiveWords, sourceRef, standingWords, whyLine } from '../provenance'
import { groupByDominion, UNFILED_GROUP_NAME } from '../groups'

const at = new Date('2026-10-05T12:00:00Z')
const row = (over: Record<string, unknown> = {}) => ({
  type: 'note', streamClass: 'idea', source: 'manual', sourceMetadata: {}, createdAt: at, ...over,
})

describe('originWords', () => {
  it('says who wrote it in plain words', () => {
    expect(originWords(row())).toBe('You')
    expect(originWords(row({ source: 'claude' }))).toBe('An AI agent working for you')
    expect(originWords(row({ source: 'cron' }))).toBe('Vorath\u2019s own thinking')
    expect(originWords(row({ source: 'webhook' }))).toBe('Outside content')
    expect(originWords(row({ source: 'manual', sourceMetadata: { origin: { kind: 'agent' } } }))).toBe('An AI agent working for you')
  })
})

describe('sourceRef', () => {
  it('names the source and links projects', () => {
    expect(sourceRef(row({ source: 'voice' })).label).toBe('a voice note you dictated')
    expect(sourceRef(row({ source: 'cron', sourceMetadata: { chatDistill: { date: '2026-10-04', threadId: 't' } } })).label)
      .toBe('your chat with Vorath on 2026-10-04')
    expect(sourceRef(row({ source: 'claude', sourceMetadata: { sessionId: 's', repo: 'aeon' } })).label).toBe('a claude coding session in aeon')
    expect(sourceRef(row({ source: 'system', projectId: 'p1', taskId: 't1' }))).toEqual({ label: 'a card on your board', href: '/project/p1' })
    expect(sourceRef(row()).label).toBe('a note you wrote in Aeon')
  })
})

describe('standingWords', () => {
  it('prefers standing, then belief confidence, then the row prior', () => {
    expect(standingWords({ standing: 0.8, confidence: 0.1, sourceMetadata: {} })).toBe('held firmly')
    expect(standingWords({ standing: null, confidence: 0.55, sourceMetadata: {} })).toBe('fairly sure')
    expect(standingWords({ standing: null, confidence: null, sourceMetadata: {} })).toBe('not weighed yet')
    expect(standingWords({ standing: 0.1, confidence: null, sourceMetadata: {} })).toMatch(/worth checking/)
  })
})

describe('whyLine', () => {
  it('explains a plain memory', () => {
    expect(whyLine(row({ source: 'claude', sourceMetadata: { repo: 'aeon' } }))).toMatch(/^I remember this because an AI agent working for you wrote it, from a claude coding session in aeon \(/)
    expect(whyLine(row({ type: 'fact' }))).toMatch(/^I know this because you told me, from a note you wrote in Aeon/)
  })

  it('explains a belief by its supporting notes', () => {
    const belief = {
      v: 1, mind: 'aligned', domain: 'work', dominionId: null, claim: 'c', reasons: [], falsifier: 'f',
      sourceType: 'operator', provenance: ['a', 'b'], status: 'held', confidence: 0.8,
    }
    expect(whyLine(row({ type: 'belief', streamClass: 'belief', source: 'cron', sourceMetadata: { belief } })))
      .toMatch(/^I believe this from 2 notes, mostly your own words/)
    const flagged = { ...belief, recheck: { since: 'x', lostSources: [{ id: 'a', state: 'archived' }] } }
    expect(recheckWords({ belief: flagged })).toBe('One note it rested on changed or went away.')
    expect(recheckWords({ belief })).toBeNull()
  })
})

describe('sensitiveWords / opWords', () => {
  it('describes topics and history entries', () => {
    expect(sensitiveWords({ sensitiveTopics: ['health', 'money'] })).toBe('health, money or debt')
    expect(sensitiveWords({})).toBeNull()
    expect(opWords({ op: 'reject', step: 'owner' })).toBe('You marked it wrong')
    expect(opWords({ op: 'recheck', step: 'recheck' })).toBe('Vorath: flagged for re-check')
  })
})

describe('groupByDominion', () => {
  it('groups by area, biggest first, unfiled last', () => {
    const groups = groupByDominion([
      { id: '1', dominionId: null, dominionName: null },
      { id: '2', dominionId: 'd1', dominionName: 'Work' },
      { id: '3', dominionId: 'd2', dominionName: 'Health' },
      { id: '4', dominionId: 'd2', dominionName: 'Health' },
    ])
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([['Health', 2], ['Work', 1], [UNFILED_GROUP_NAME, 1]])
  })
})
