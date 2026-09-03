import { describe, it, expect } from 'vitest'
import {
  addUsage, buildTimeline, emptyTotals, formatCost, formatDuration, formatTokens, heartbeatStale,
  type ToolItem,
} from '../timeline'
import type { SessionEvent } from '@/lib/db/schema'

// Edge paths of the timeline builder the drawer leans on: degraded results,
// error rows, status-derived termination, and the display formatters.

let idCounter = 0
function event(seq: number, kind: string, payload: Record<string, unknown> = {}, toolName: string | null = null): SessionEvent {
  return {
    id: `e${++idCounter}`,
    sessionId: 's1',
    seq,
    kind,
    toolName,
    payload,
    createdAt: new Date('2026-08-21T12:00:00Z'),
  } as SessionEvent
}

describe('buildTimeline edges', () => {
  it('an unpaired tool_result degrades to a raw row instead of vanishing', () => {
    const t = buildTimeline([event(1, 'tool_result', { toolUseId: 'missing', content: 'orphan output' })])
    expect(t.items).toEqual([{ type: 'raw', seq: 1, text: 'orphan output' }])
    // …but an empty orphan renders nothing.
    expect(buildTimeline([event(2, 'tool_result', { toolUseId: 'missing', content: '' })]).items).toEqual([])
  })

  it('maps error rows from either message or text', () => {
    const t = buildTimeline([
      event(1, 'error', { message: 'boom' }),
      event(2, 'error', { text: 'legacy boom' }),
      event(3, 'error', {}),
    ])
    expect(t.items).toEqual([
      { type: 'error', seq: 1, message: 'boom' },
      { type: 'error', seq: 2, message: 'legacy boom' },
    ])
  })

  it('forceTerminal ends a mission killed without a stop/result row', () => {
    const events = [event(1, 'tool_use', { toolUseId: 'tu1' }, 'Bash')]
    expect(buildTimeline(events).terminal).toBe(false)
    expect((buildTimeline(events).items[0] as ToolItem).running).toBe(true)

    const killed = buildTimeline(events, { forceTerminal: true })
    expect(killed.terminal).toBe(true)
    expect((killed.items[0] as ToolItem).running).toBe(false)
  })

  it('addUsage accumulates monotonically and ignores non-numeric fields', () => {
    const totals = emptyTotals()
    addUsage(totals, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheCreationTokens: 7 })
    addUsage(totals, { inputTokens: 'NaN-ish', outputTokens: Infinity })
    expect(totals).toEqual({ requests: 2, inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheCreationTokens: 7 })
  })
})

describe('heartbeatStale with string timestamps', () => {
  const now = Date.parse('2026-08-21T12:10:00Z')
  it('parses ISO strings like Date objects', () => {
    expect(heartbeatStale('2026-08-21T12:09:30Z', now)).toBe(false)
    expect(heartbeatStale('2026-08-21T12:08:00Z', now)).toBe(true)
  })
  it('an unparseable string is never flagged stale', () => {
    expect(heartbeatStale('not a date', now)).toBe(false)
  })
})

describe('formatters', () => {
  it('formatTokens switches units at 1k and 1M', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1000)).toBe('1.0k')
    expect(formatTokens(999_999)).toBe('1000.0k')
    expect(formatTokens(1_000_000)).toBe('1.0M')
  })
  it('formatCost shows cents below a dollar and 2dp above', () => {
    expect(formatCost(0.0421)).toBe('$0.0421')
    expect(formatCost(1)).toBe('$1.00')
    expect(formatCost(12.345)).toBe('$12.35')
  })
  it('formatDuration steps through s / m s / h m', () => {
    expect(formatDuration(59_900)).toBe('60s')
    expect(formatDuration(60_000)).toBe('1m 0s')
    expect(formatDuration(3_599_000)).toBe('59m 59s')
    expect(formatDuration(3_600_000)).toBe('1h 0m')
  })
})
