import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 06:00 message × moment seam: lane openings lead the message, lane tail lines
// follow the Horae line, lane prompt blocks follow the stage block, and the
// delivered hook runs once after a successful send. Empty = unchanged.

const lanes = vi.hoisted(() => ({ rapport: {} as Record<string, unknown> }))
const selectQueue = vi.hoisted(() => [] as unknown[][])
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('@/lib/db', () => {
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {}
    c.from = () => c
    c.where = () => c
    c.then = (resolve: (v: unknown[]) => unknown) => resolve(rows)
    return c
  }
  return {
    db: {
      select: vi.fn(() => chain(selectQueue.shift() ?? [{ n: 0 }])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: vi.fn(async () => ({ rows: [{ locked: true }] })) })),
    },
  }
})
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../../speak', () => ({ deliverKairosSpeak: vi.fn() }))
vi.mock('../../cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('../../daily-message-inputs', () => ({ gatherDailyMessageInputs: vi.fn() }))
vi.mock('../../conscience-context', () => ({ loadConscienceBlock: vi.fn(async () => '') }))
vi.mock('../../promises/check', () => ({ PROMISE_CHECK_CRON: 'promise-check', verifyOpenPromises: vi.fn() }))

import { getProviderForTask } from '@/lib/ai/route-task'
import { deliverKairosSpeak } from '../../speak'
import { gatherDailyMessageInputs } from '../../daily-message-inputs'
import { buildDailyMessageUserPrompt, type DailyMessageInputs } from '../../daily-message-prompt'
import { tailBlocks } from '../../daily-message-today'
import { runDailyMessageForUser } from '../../daily-message'

const USER = 'user-1'
const NOW = new Date('2026-10-01T05:00:00.000Z')
const INPUTS: DailyMessageInputs = {
  date: '2026-10-01', isMonday: false, areas: [{ dominion: 'AEON', headline: 'Ship it.' }], aether: null, boardDay: null,
  promotions: null, newBeliefs: null, drift: null, openAsks: null, synthesis: null, mindCompare: null, failed: [],
}

const sentMessage = () => vi.mocked(deliverKairosSpeak).mock.calls[0][1].message

beforeEach(() => {
  vi.clearAllMocks()
  selectQueue.length = 0
  vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask: vi.fn(async () => ({ text: '{"message": "**Today** text."}', finishReason: 'stop' })) } } as never)
  vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
})

afterEach(() => {
  for (const key of Object.keys(lanes.rapport)) delete lanes.rapport[key]
})

describe('daily prompt blocks', () => {
  it('tailBlocks is the old stage line when no lane adds blocks', () => {
    expect(tailBlocks({})).toEqual([])
    expect(tailBlocks({ stage: '  STAGE  ' })).toEqual(['', 'STAGE'])
    expect(tailBlocks({ stage: 'STAGE', moment: { promptBlocks: ['OWNER MODEL'] } })).toEqual(['', 'STAGE', '', 'OWNER MODEL'])
  })

  it('renders lane blocks after the stage and before the conscience block', () => {
    const base = buildDailyMessageUserPrompt({ ...INPUTS, stage: 'STAGE' }, 'CONSCIENCE')
    expect(base.endsWith('\n\nSTAGE\n\nCONSCIENCE')).toBe(true)
    const withMoment = buildDailyMessageUserPrompt({ ...INPUTS, stage: 'STAGE', moment: { openings: ['x'], tail: ['y'] } }, 'CONSCIENCE')
    expect(withMoment).toBe(base)
    expect(buildDailyMessageUserPrompt({ ...INPUTS, stage: 'STAGE', moment: { promptBlocks: ['MOMENT'] } }, 'CONSCIENCE'))
      .toBe(base.replace('\n\nSTAGE\n\nCONSCIENCE', '\n\nSTAGE\n\nMOMENT\n\nCONSCIENCE'))
  })
})

describe('daily message text', () => {
  it('openings lead and tail lines close the message; absent moment = the base text', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
    await runDailyMessageForUser(USER, { now: NOW })
    const base = sentMessage()
    expect(base).toBe('**Today** text.')

    vi.clearAllMocks()
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({ ...INPUTS, moment: { openings: ['I pushed too hard yesterday.'], tail: ['⚖️ Trust line.'] } })
    vi.mocked(getProviderForTask).mockResolvedValue({ provider: { ask: vi.fn(async () => ({ text: '{"message": "**Today** text."}', finishReason: 'stop' })) } } as never)
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 200, body: { id: 'm1', delivered: { inbox: true, telegram: true } } })
    await runDailyMessageForUser(USER, { now: NOW })
    expect(sentMessage()).toBe(`I pushed too hard yesterday.\n\n${base}\n\n⚖️ Trust line.`)
  })

  it('runs the delivered hook once after a send, with the moment inputs', async () => {
    const delivered = vi.fn()
    lanes.rapport.dailyDelivered = delivered
    const moment = { openings: ['Opening.'] }
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({ ...INPUTS, moment })
    await runDailyMessageForUser(USER, { now: NOW })
    expect(delivered).toHaveBeenCalledOnce()
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, date: '2026-10-01', memoryId: 'm1', telegram: true, moment }))
  })

  it('a blocked delivery never runs the delivered hook', async () => {
    const delivered = vi.fn()
    lanes.rapport.dailyDelivered = delivered
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue(INPUTS)
    vi.mocked(deliverKairosSpeak).mockResolvedValue({ status: 429, body: { error: 'throttled' } })
    await runDailyMessageForUser(USER, { now: NOW })
    expect(delivered).not.toHaveBeenCalled()
  })
})
