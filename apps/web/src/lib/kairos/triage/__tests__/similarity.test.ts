import { describe, expect, it } from 'vitest'
import { cardSimilarity, pickDuplicateCandidates, wordTokens } from '../similarity'

const card = (id: string, name: string, description: string | null = null) => ({ id, name, description })

describe('card similarity pre-filter', () => {
  it('tokenises case-, accent- and plural-insensitively and drops filler words', () => {
    expect([...wordTokens('Fix the Login bugs on Café page')].sort()).toEqual(['bug', 'cafe', 'fix', 'login', 'page'])
  })

  it('scores a reworded title well above an unrelated one', () => {
    const a = card('a', 'Fix login bug on mobile')
    expect(cardSimilarity(a, card('b', 'Mobile login bug fix'))).toBeGreaterThan(0.6)
    expect(cardSimilarity(a, card('c', 'Plan quarterly budget review'))).toBeLessThan(0.15)
  })

  it('picks the closest candidates best first, never the card itself, above the floor and capped', () => {
    const target = card('n1', 'Write onboarding email sequence')
    const pool = [
      target,
      card('e1', 'Onboarding email sequence draft'),
      card('e2', 'Email sequence for onboarding v2'),
      card('e3', 'Renew domain'),
      card('e4', 'Onboarding emails'),
    ]
    const picked = pickDuplicateCandidates(target, pool, { limit: 2 })
    expect(picked.map((p) => p.card.id)).toHaveLength(2)
    expect(picked.map((p) => p.card.id)).not.toContain('n1')
    expect(picked.map((p) => p.card.id)).not.toContain('e3')
    expect(picked[0].score).toBeGreaterThanOrEqual(picked[1].score)
  })

  it('returns nothing for empty titles or an empty pool', () => {
    expect(pickDuplicateCandidates(card('n', ''), [card('x', '')])).toEqual([])
    expect(pickDuplicateCandidates(card('n', 'Ship it'), [])).toEqual([])
  })
})
