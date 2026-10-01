import { describe, expect, it, vi } from 'vitest'

// P2 (docs/kairos/34): beliefs and the constitution are curated by the
// operator — the machine Merge step and the concept clusterer must never
// fold, cluster or absorb them. Lock the exclusion constants both read.

vi.mock('@/lib/db', () => ({ db: {} }))

import { CONCEPT_EXCLUDED_STREAMS, CONCEPT_EXCLUDED_TYPES } from '../concepts'
import { MERGE_EXCLUDED_STREAMS, MERGE_EXCLUDED_TYPES } from '@/lib/kairos/engine/steps/merge'

describe('belief / constitution exclusions', () => {
  it.each([
    ['MERGE_EXCLUDED_TYPES', MERGE_EXCLUDED_TYPES as readonly string[]],
    ['MERGE_EXCLUDED_STREAMS', MERGE_EXCLUDED_STREAMS as readonly string[]],
    ['CONCEPT_EXCLUDED_TYPES', CONCEPT_EXCLUDED_TYPES as readonly string[]],
    ['CONCEPT_EXCLUDED_STREAMS', CONCEPT_EXCLUDED_STREAMS as readonly string[]],
  ])('%s includes belief and constitution', (_name, list) => {
    expect(list).toContain('belief')
    expect(list).toContain('constitution')
  })
})
