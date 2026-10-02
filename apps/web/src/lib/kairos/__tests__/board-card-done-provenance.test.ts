import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { resolveWriteOrigin } from '@/lib/data/memories'
import { summariseSupport } from '../engine/steps/back-up'
import { inferOriginKind, originKindOf } from '../origin'
import type { SupportRow } from '@/lib/data/memory-candidates'

// A finished card on a watched board is captured the same day as
// kind 'board_card_done' (source 'system'). It is the owner's activity for
// trust, but the nightly board_day page stays the single anchored record:
// the card row must not count again as BackUp support.

const CARD_DONE = { source: 'system', sourceMetadata: { kind: 'board_card_done', externalId: 'board-done:t:2026-10-02' } }

function support(id: string, at: string, row: { source: string; sourceMetadata: Record<string, unknown> }): SupportRow {
  return { id, createdAt: new Date(at), links: [], similarity: 0.9, ...row }
}

describe('board_card_done provenance', () => {
  it('is activity origin when Kairos writes it', () => {
    expect(inferOriginKind('system', CARD_DONE.sourceMetadata)).toBe('activity')
    expect(originKindOf(CARD_DONE)).toBe('activity')
    expect(resolveWriteOrigin('system', CARD_DONE.sourceMetadata)).toEqual({ kind: 'activity' })
  })

  it('cannot be self-stamped by a bearer client: the source caps the trusted origin', () => {
    expect(resolveWriteOrigin('claude', { kind: 'board_card_done' }, { kind: 'agent', via: 'mcp' })).toEqual({ kind: 'agent', via: 'mcp' })
    expect(resolveWriteOrigin('webhook', { kind: 'board_card_done' }, { kind: 'agent', via: 'rest' })).toEqual({ kind: 'external', via: 'rest' })
  })

  it('never counts as BackUp support, while the nightly board_day page still anchors', () => {
    expect(summariseSupport('prop-1', [
      support('card', '2026-10-01T10:00:00Z', CARD_DONE),
      support('card-2', '2026-10-02T10:00:00Z', CARD_DONE),
    ])).toEqual({ independentSupports: 0, distinctDays: 0, anchoredSupports: 0 })

    expect(summariseSupport('prop-1', [
      support('card', '2026-10-01T10:00:00Z', CARD_DONE),
      support('day', '2026-10-01T23:00:00Z', { source: 'cron', sourceMetadata: { kind: 'board_day' } }),
    ])).toEqual({ independentSupports: 1, distinctDays: 1, anchoredSupports: 1 })
  })
})
