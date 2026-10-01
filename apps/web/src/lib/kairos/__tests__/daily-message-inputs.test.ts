import { beforeEach, describe, expect, it, vi } from 'vitest'

// Direct memory reads (briefs, new beliefs, mind compare) go through db.select;
// each call takes the next queued result (an Error rejects that one read).
const selectQueue: Array<unknown[] | Error> = []

vi.mock('@/lib/db', () => {
  function makeChain(result: unknown[] | Error) {
    const chain: Record<string, unknown> = {}
    const pass = () => chain
    chain.from = pass
    chain.where = pass
    chain.orderBy = pass
    chain.limit = pass
    chain.then = (resolve: (v: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
      result instanceof Error ? reject(result) : resolve(result)
    return chain
  }
  return { db: { select: vi.fn(() => makeChain(selectQueue.shift() ?? [])) } }
})

vi.mock('@/lib/data/aether', () => ({ getLatestAether: vi.fn() }))
vi.mock('@/lib/data/ask', () => ({ getPendingKairosAsk: vi.fn() }))
vi.mock('@/lib/data/board-feed', () => ({ listBoardDayPages: vi.fn() }))
vi.mock('@/lib/data/memory-candidates', () => ({ listPromotedBeliefsBetween: vi.fn() }))
vi.mock('@/lib/data/recipes', () => ({ listTraceHistory: vi.fn() }))
vi.mock('../constitution/amendment', () => ({ getLatestDriftStatus: vi.fn() }))
vi.mock('../synthesis-health', () => ({ SYNTHESIS_HEALTH_RECIPE: 'SYNTHESIS_HEALTH' }))

import { getLatestAether } from '@/lib/data/aether'
import { getPendingKairosAsk } from '@/lib/data/ask'
import { listBoardDayPages } from '@/lib/data/board-feed'
import { listPromotedBeliefsBetween } from '@/lib/data/memory-candidates'
import { listTraceHistory } from '@/lib/data/recipes'
import { getLatestDriftStatus } from '../constitution/amendment'
import { briefDominionName, briefFirstLines, gatherDailyMessageInputs } from '../daily-message-inputs'

const USER = 'user-1'
const NOW = new Date('2026-10-26T08:00:00.000Z') // Monday, 08:00 London (GMT)

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(getLatestAether).mockResolvedValue(null)
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
  vi.mocked(listBoardDayPages).mockResolvedValue([])
  vi.mocked(listPromotedBeliefsBetween).mockResolvedValue([])
  vi.mocked(listTraceHistory).mockResolvedValue([])
  vi.mocked(getLatestDriftStatus).mockResolvedValue(null)
})

describe('gatherDailyMessageInputs', () => {
  it('reads every input and shapes it for the prompt', async () => {
    selectQueue.push(
      [{ title: '2026-10-26 · AEON briefing', bodyMd: '## State\n**Movement**\n- Ship [the fix](https://x.io) **today**\nSecond line\nThird' }],
      [{ title: 'b', sourceMetadata: { belief: { mind: 'own', claim: 'Small batches win' } } }],
      [{ summary: 'Agree on 4, diverge on 1', bodyMd: null }],
    )
    vi.mocked(getLatestAether).mockResolvedValue({
      generatedAt: '', coreNarrative: '', tensions: [], shifts: [],
      thoughts: [0.2, 0.9, 0.5, 0.7].map((salience, i) => ({
        id: `t${i}`, title: `T${i}`, insight: `I${i}`, dominionId: null, dominionName: null, dominionColor: null,
        salience, kind: 'conclusion' as const, sourceMemoryIds: [], ageDays: 0,
      })),
    })
    vi.mocked(listBoardDayPages).mockResolvedValue([
      { id: 'p1', projectId: 'x', dominionId: null, sourceMetadata: { finished: [{ title: 'A' }, { title: 'B' }], thinCards: [{ title: 'A' }] } },
      { id: 'p2', projectId: 'y', dominionId: null, sourceMetadata: { finished: [{ title: 'C' }, { title: 'D' }] } },
    ])
    vi.mocked(getLatestDriftStatus).mockResolvedValue({
      date: '2026-10-26', version: 2, mean: 0.74, alert: true,
      flipped: [{ probeId: 'p', question: 'What matters most?', sim: 0.5 }], measuredAt: new Date('2026-10-26T04:00:00Z'),
    })
    vi.mocked(getPendingKairosAsk).mockResolvedValue({ title: 'Why the pause?', kairosAsk: { status: 'pending' } } as never)
    vi.mocked(listTraceHistory).mockResolvedValue([{
      createdAt: new Date('2026-10-26T06:45:00Z'),
      sourceMetadata: { byStage: { cortex: { '2026-10-26': 'failed' }, aether: { '2026-10-26': 'ok' } } },
    }] as never)

    const inputs = await gatherDailyMessageInputs(USER, NOW)

    expect(listBoardDayPages).toHaveBeenCalledWith(USER, '2026-10-25')
    expect(inputs).toMatchObject({
      date: '2026-10-26',
      isMonday: true,
      briefs: [{ dominion: 'AEON', lines: ['Ship the fix today', 'Second line'] }],
      boardDay: { finished: 4, finishedTitles: ['A', 'B', 'C'], thinCards: 1 },
      newBeliefs: [{ mind: 'own', claim: 'Small batches win' }],
      drift: { alert: true },
      pendingAsk: 'Why the pause?',
      synthesis: { green: 1, failed: 1, failedStages: ['cortex'] },
      mindCompare: 'Agree on 4, diverge on 1',
      failed: [],
    })
    expect(inputs.aether?.map((t) => t.title)).toEqual(['T1', 'T3', 'T2'])
    expect(inputs.drift?.summary).toContain('0.74')
  })

  it('tolerates every input failing: nulls plus the failed names, never a throw', async () => {
    selectQueue.push(new Error('briefs down'), new Error('beliefs down'), new Error('compare down'))
    vi.mocked(getLatestAether).mockRejectedValue(new Error('x'))
    vi.mocked(listBoardDayPages).mockRejectedValue(new Error('x'))
    vi.mocked(listPromotedBeliefsBetween).mockRejectedValue(new Error('memory_ops missing'))
    vi.mocked(getLatestDriftStatus).mockRejectedValue(new Error('x'))
    vi.mocked(getPendingKairosAsk).mockRejectedValue(new Error('x'))
    vi.mocked(listTraceHistory).mockRejectedValue(new Error('x'))

    const inputs = await gatherDailyMessageInputs(USER, NOW)
    expect(inputs.failed).toEqual(['aether', 'boardDay', 'briefs', 'drift', 'mindCompare', 'newBeliefs', 'pendingAsk', 'promotions', 'synthesis'])
    expect(inputs.briefs).toBeNull()
    expect(inputs.promotions).toBeNull()
  })

  it('ignores a stale synthesis rollup, an old drift run and skips mind compare off-Monday', async () => {
    vi.mocked(listTraceHistory).mockResolvedValue([{
      createdAt: new Date('2026-10-26T23:00:00Z'), sourceMetadata: { byStage: { cortex: { d: 'failed' } } },
    }] as never)
    vi.mocked(getLatestDriftStatus).mockResolvedValue({
      date: '2026-10-20', version: 1, mean: 0.5, alert: true, flipped: [], measuredAt: new Date('2026-10-20T04:00:00Z'),
    })
    const inputs = await gatherDailyMessageInputs(USER, new Date('2026-10-27T08:00:00Z')) // Tuesday
    expect(inputs.synthesis).toBeNull()
    expect(inputs.drift).toBeNull()
    expect(inputs.mindCompare).toBeNull()
    expect(inputs.isMonday).toBe(false)
  })
})

describe('brief helpers', () => {
  it('extracts the Dominion name from the brief title', () => {
    expect(briefDominionName('2026-10-01 · Shadow Lab briefing')).toBe('Shadow Lab')
  })

  it('drops headings/labels and strips links', () => {
    expect(briefFirstLines('# H\n**State**\nSee https://a.b now\n')).toEqual(['See now'])
  })
})
