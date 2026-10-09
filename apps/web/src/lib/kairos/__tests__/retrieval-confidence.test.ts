import { describe, it, expect } from 'vitest'
import { RETRIEVAL_CONFIDENCE_FLOOR, assessConfidence } from '../retrieval-confidence'

// Confidence floor chosen from eval/scores-0910.json: flag, never drop.

describe('assessConfidence', () => {
  it('flags the eval abstention questions (best rerank relevance ≤ 0.494)', () => {
    for (const rel of [0.318, 0.393, 0.402, 0.494]) {
      expect(assessConfidence(rel)).toEqual({ confidence: rel, lowConfidence: true })
    }
  })

  it('keeps the weakest unflagged top-5 hit (tm04, 0.660) and strong matches above the floor', () => {
    expect(assessConfidence(0.66).lowConfidence).toBe(false)
    expect(assessConfidence(0.945).lowConfidence).toBe(false)
  })

  it('is inclusive at the floor and rounds the reported confidence', () => {
    expect(assessConfidence(RETRIEVAL_CONFIDENCE_FLOOR).lowConfidence).toBe(false)
    expect(assessConfidence(0.549999).lowConfidence).toBe(true)
    expect(assessConfidence(0.81234).confidence).toBe(0.812)
  })

  it('reports no signal (null, unflagged) without a reranked score', () => {
    expect(assessConfidence(null)).toEqual({ confidence: null, lowConfidence: false })
    expect(assessConfidence(undefined)).toEqual({ confidence: null, lowConfidence: false })
    expect(assessConfidence(Number.NaN)).toEqual({ confidence: null, lowConfidence: false })
  })
})
