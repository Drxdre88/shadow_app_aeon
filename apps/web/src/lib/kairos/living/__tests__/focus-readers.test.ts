import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Living Dominions lane B readers: the aether inputs and the 06:00 area
// headlines leave dormant Dominions out (and areas rank by activity) only when on.

const selectQueue: unknown[][] = []

vi.mock('@/lib/db', () => {
  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.innerJoin = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return chain
  }
  return { db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) } }
})
vi.mock('@/lib/data/memories', () => ({ captureMemory: vi.fn(), validAsOfNow: 'mock-valid-as-of-now' }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

import { fetchAetherInputs } from '../../aether'
import { readAreaHeadlines } from '../../daily-message-inputs'
import { areaRowLimit, orderAreaRows } from '../focus-areas'

const dom = (id: string, focusState: string, pinned: boolean) => ({ id, name: id.toUpperCase(), color: null, focusState, pinned })

function cortexRow(dominionId: string, createdAt: string) {
  return { id: `c-${dominionId}-${createdAt}`, dominionId, createdAt: new Date(createdAt), sourceMetadata: { cortex: { visionAnchor: `${dominionId} anchor` } } }
}

function area(dominionId: string, summary: string, focusState: string, pinned: boolean, activityScore: number, sortOrder: number) {
  return { dominionId, dominion: dominionId.toUpperCase(), summary, focusState, pinned, activityScore, sortOrder }
}

// Newest cortex first (the SQL order): dormant newest, then live, pinned, quiet.
const areaRows = [
  area('dormant', 'Dormant headline.', 'dormant', false, 9, 0),
  area('live', 'Live newest.', 'active', false, 2, 1),
  area('pinned', 'Pinned headline.', 'dormant', true, 5, 2),
  area('live', 'Live older.', 'active', false, 2, 1),
  area('quiet', 'Quiet headline.', 'active', false, 0, 3),
]

beforeEach(() => {
  selectQueue.length = 0
  vi.stubEnv('KAIROS_LIVING_DOMINIONS', '')
})

afterEach(() => vi.unstubAllEnvs())

async function areas() {
  selectQueue.push(areaRows)
  return readAreaHeadlines('user-1')
}

describe('06:00 area headlines', () => {
  it('keeps newest-cortex order with every live Dominion when off', async () => {
    expect(await areas()).toEqual([
      { dominion: 'DORMANT', headline: 'Dormant headline.' },
      { dominion: 'LIVE', headline: 'Live newest.' },
      { dominion: 'PINNED', headline: 'Pinned headline.' },
      { dominion: 'QUIET', headline: 'Quiet headline.' },
    ])
    expect(areaRowLimit(30)).toBe(30)
  })

  it("is identical to off in 'observe'", async () => {
    const off = await areas()
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'observe')
    expect(await areas()).toEqual(off)
    expect(areaRowLimit(30)).toBe(30)
  })

  it("drops dormant, keeps pinned and leads by activity when 'on'", async () => {
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', '1')
    expect(await areas()).toEqual([
      { dominion: 'PINNED', headline: 'Pinned headline.' },
      { dominion: 'LIVE', headline: 'Live newest.' },
      { dominion: 'QUIET', headline: 'Quiet headline.' },
    ])
    expect(areaRowLimit(30)).toBeGreaterThan(30)
  })

  it('returns the very same rows when off', () => {
    expect(orderAreaRows(areaRows)).toBe(areaRows)
  })
})

describe('aether inputs', () => {
  async function snapshotDominions() {
    selectQueue.push(
      [dom('live', 'active', false), dom('dormant', 'dormant', false), dom('pinned', 'dormant', true)],
      [cortexRow('dormant', '2026-10-05T03:00:00Z'), cortexRow('live', '2026-10-05T02:59:00Z'), cortexRow('pinned', '2026-10-04T03:00:00Z')],
    )
    const inputs = await fetchAetherInputs('user-1')
    return inputs.cortexSnapshots.map((c) => c.dominionId)
  }

  it("feeds every live Dominion's cortex when off or 'observe'", async () => {
    expect(await snapshotDominions()).toEqual(['dormant', 'live', 'pinned'])
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'observe')
    expect(await snapshotDominions()).toEqual(['dormant', 'live', 'pinned'])
  })

  it("leaves dormant Dominions' cortex out when 'on'", async () => {
    vi.stubEnv('KAIROS_LIVING_DOMINIONS', 'on')
    expect(await snapshotDominions()).toEqual(['live', 'pinned'])
  })
})
