import { describe, expect, it } from 'vitest'
import { matchScore, planArchetypeEdits, type IncomingArchetype, type LiveArchetype } from '../archetype-match'

const BODY = 'Every nightly synthesis now flows through the thinking queue, answered on Max with the paid crons as fallback. The next move is retiring the paid key.'

function live(id: string, title: string, overrides: Partial<LiveArchetype> = {}): LiveArchetype {
  return { id, title, summary: `${title} shapes the work.`, bodyMd: BODY, pinned: false, ...overrides }
}

function incoming(title: string, overrides: Partial<IncomingArchetype> = {}): IncomingArchetype {
  return { title, summary: `${title} shapes the work.`, body: BODY, themes: ['kairos'], citedMemoryIds: [], ...overrides }
}

describe('planArchetypeEdits', () => {
  it('keeps a matched, essentially unchanged archetype', () => {
    const plan = planArchetypeEdits([live('a', 'Queue first')], [incoming('Queue First!')])
    expect(plan.edits).toEqual([expect.objectContaining({ kind: 'keep', existing: expect.objectContaining({ id: 'a' }) })])
    expect(plan.archiveIds).toEqual([])
  })

  it('updates a matched archetype whose body moved on', () => {
    const plan = planArchetypeEdits(
      [live('a', 'Queue first')],
      [incoming('Queue first', { body: 'A different reading entirely: the board migration and auth hardening now dominate, with mobile parked until beta exit lands.' })],
    )
    expect(plan.edits.map((e) => e.kind)).toEqual(['update'])
  })

  it('updates a renamed archetype matched by a near title', () => {
    const plan = planArchetypeEdits([live('a', 'Thinking queue spine')], [incoming('The thinking queue spine of the night')])
    expect(plan.edits).toEqual([expect.objectContaining({ kind: 'update', existing: expect.objectContaining({ id: 'a' }) })])
  })

  it('inserts unmatched new archetypes and archives live ones not returned', () => {
    const plan = planArchetypeEdits(
      [live('a', 'Queue first'), live('b', 'Mobile parked')],
      [incoming('Queue first'), incoming('Beta auth hardening')],
    )
    expect(plan.edits.map((e) => e.kind)).toEqual(['keep', 'insert'])
    expect(plan.archiveIds).toEqual(['b'])
  })

  it('never updates or archives a pinned archetype, but matches it so it is not duplicated', () => {
    const pinned = live('p', 'Queue first', { pinned: true })
    const changed = planArchetypeEdits([pinned], [incoming('Queue first', { body: 'Totally rewritten content about something else, long enough to clear the schema minimum easily here.' })])
    expect(changed.edits).toEqual([expect.objectContaining({ kind: 'keep' })])
    expect(planArchetypeEdits([pinned], [incoming('Brand new theme')]).archiveIds).toEqual([])
  })

  it('pairs one-to-one, best match first', () => {
    const plan = planArchetypeEdits(
      [live('a', 'Queue first'), live('b', 'Queue first and paid key retirement')],
      [incoming('Queue first and paid key retirement'), incoming('Queue first')],
    )
    expect(plan.edits.map((e) => (e.kind === 'insert' ? 'new' : e.existing.id))).toEqual(['b', 'a'])
  })

  it('does not match unrelated titles', () => {
    expect(matchScore(live('a', 'Queue first'), incoming('Mobile parked'))).toBeNull()
  })
})
