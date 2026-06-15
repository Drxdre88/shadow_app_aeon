import { describe, it, expect, vi } from 'vitest'

// memories.ts eagerly constructs the DB client on import; the helper under test
// is pure and never touches it, so a bare mock keeps the module loadable.
vi.mock('@/lib/db', () => ({ db: {} }))

import { SUMMARY_WORTHY_TYPES, summaryBacklogTypes } from '../memories'

describe('summaryBacklogTypes', () => {
  it('defaults to the summary-worthy allowlist when no type is given', () => {
    expect(summaryBacklogTypes()).toEqual([...SUMMARY_WORTHY_TYPES])
  })

  it('excludes machine/synthesis types from the default backlog', () => {
    const def = summaryBacklogTypes()
    for (const noise of [
      'snapshot', 'achievement', 'session_event', 'advisory',
      'external_event', 'inbound', 'archetype', 'dominion_cortex', 'aether',
    ]) {
      expect(def).not.toContain(noise)
    }
  })

  it('honours an explicit single type (override, even a machine type)', () => {
    expect(summaryBacklogTypes('snapshot')).toEqual(['snapshot'])
  })

  it('honours an explicit array of types', () => {
    expect(summaryBacklogTypes(['note', 'reflection'])).toEqual(['note', 'reflection'])
  })

  it('only contains human/narrative types in the allowlist', () => {
    expect([...SUMMARY_WORTHY_TYPES]).toEqual([
      'note', 'decision', 'idea', 'observation', 'session_summary', 'reflection',
    ])
  })
})
