import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({
  hasJobWithKeyLike: vi.fn(),
  hasLiveOpenJob: vi.fn(),
  isJobDone: vi.fn(),
}))
vi.mock('@/lib/data/ask', () => ({
  createKairosAskMemory: vi.fn(),
  listOpenKairosAsks: vi.fn(),
  listKairosReflectionStaleness: vi.fn(),
  listRecentKairosAsks: vi.fn(),
}))
vi.mock('@/lib/data/board-signals', () => ({
  listStaleTasks: vi.fn(),
  listRecentlyCompletedTasks: vi.fn(),
  listRecentlyCreatedTasks: vi.fn(),
}))
vi.mock('@/lib/data/board-feed', () => ({ listBoardDayPages: vi.fn() }))
vi.mock('@/lib/data/dominions', () => ({ findDominionsByUser: vi.fn() }))
vi.mock('@/lib/kairos/engagement', () => ({ getConversationState: vi.fn() }))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: vi.fn(), fetchAetherInputs: vi.fn() }))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))

import { getProviderForTask } from '@/lib/ai/route-task'
import {
  createKairosAskMemory,
  listOpenKairosAsks,
  listKairosReflectionStaleness,
  listRecentKairosAsks,
  type KairosAskRow,
} from '@/lib/data/ask'
import { listBoardDayPages } from '@/lib/data/board-feed'
import { listRecentlyCompletedTasks, listRecentlyCreatedTasks, listStaleTasks } from '@/lib/data/board-signals'
import { findDominionsByUser } from '@/lib/data/dominions'
import { hasJobWithKeyLike, hasLiveOpenJob, isJobDone } from '@/lib/data/thinking-jobs'
import * as aether from '@/lib/kairos/aether'
import { runAskMineForUser } from '@/lib/kairos/ask-mine'
import { ASK_MINE_SYSTEM_PROMPT } from '@/lib/kairos/ask-mine-prompt'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { getConversationState } from '@/lib/kairos/engagement'
import { askMineHandler } from '../handlers/ask-mine'

const USER = '11111111-1111-4111-8111-111111111111'
const DOM = '22222222-2222-4222-8222-222222222222'
const MEM = '33333333-3333-4333-8333-333333333333'
const TASK = '44444444-4444-4444-8444-444444444444'
const AETHER = '55555555-5555-4555-8555-555555555555'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00.000Z`)

const candidate = {
  question: 'Should Atlas ship before the mobile work resumes?',
  kind: 'decision',
  dominionId: DOM,
  sourceMemoryIds: [MEM],
  leverage: 0.88,
  rationale: 'Atlas gates two active workstreams.',
}
const critique = { candidateIndex: 0, clear: true, answerable: true, grounded: true, note: 'Specific and sourced.' }
const answer = (candidates: unknown[] = [candidate], selfCritique: unknown[] = [critique]) =>
  `\`\`\`json\n${JSON.stringify({ candidates, selfCritique })}\n\`\`\``

function priorAsk(overrides: Partial<KairosAskRow> = {}): KairosAskRow {
  return {
    id: 'ask-old',
    title: 'Which route ships first?',
    summary: null,
    dominionId: null,
    createdAt: new Date('2026-09-28T04:30:00.000Z'),
    kairosAsk: {
      status: 'answered',
      aetherMemoryId: 'aether-old',
      sourceThoughtId: null,
      sourceMemoryIds: ['old-memory'],
      dominionId: null,
      askedAt: '2026-09-28T04:30:00.000Z',
    },
    askMine: { date: '2026-09-28', kind: 'revival', sourceMemoryIds: ['old-memory'], leverage: 0.5 },
    ...overrides,
  }
}

function jobRow(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    userId: USER,
    kind: 'ask_mine',
    dominionId: null,
    externalKey: `ask_mine:${DAY}`,
    status: 'claimed',
    input: {
      system: ASK_MINE_SYSTEM_PROMPT,
      prompt: 'p',
      validMemoryIds: [MEM, TASK],
      context: { date: DAY, validDominionIds: [DOM], aetherMemoryId: AETHER },
    },
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: at('03:40'),
    deadlineAt: at('04:28'),
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: at('03:20'),
    updatedAt: at('03:20'),
    ...overrides,
  }
}

const aetherInputs = {
  cortexSnapshots: [],
  topReflections: [],
  archetypes: [],
  prior: {
    id: AETHER,
    createdAt: at('03:10'),
    payload: {
      generatedAt: at('03:10').toISOString(),
      coreNarrative: 'Atlas gates the initiative engine.',
      thoughts: [{
        id: 't1', title: 'Atlas gate', insight: 'Two workstreams wait on Atlas.', dominionId: DOM, dominionName: 'AEON',
        dominionColor: null, salience: 0.9, kind: 'question', sourceMemoryIds: [MEM], ageDays: 1,
      }],
      tensions: [],
      shifts: [],
    },
  },
  todaySoFar: null,
}

function silenceSignals() {
  vi.mocked(aether.fetchAetherInputs).mockResolvedValue({ ...aetherInputs, prior: null } as never)
  vi.mocked(listStaleTasks).mockResolvedValue([])
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at('03:40'))
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(hasLiveOpenJob).mockResolvedValue(false)
  vi.mocked(isJobDone).mockResolvedValue(false)
  vi.mocked(aether.alreadyRanToday).mockResolvedValue(true)
  vi.mocked(aether.fetchAetherInputs).mockResolvedValue(aetherInputs as never)
  vi.mocked(listOpenKairosAsks).mockResolvedValue([])
  vi.mocked(getConversationState).mockResolvedValue({ lastOutbound: null, replied: false, awaitingReply: false, replyRate7d: 0 })
  vi.mocked(listRecentKairosAsks).mockResolvedValue([])
  vi.mocked(listKairosReflectionStaleness).mockResolvedValue([])
  vi.mocked(findDominionsByUser).mockResolvedValue([{ id: DOM, name: 'AEON', archivedAt: null }] as never)
  vi.mocked(listStaleTasks).mockResolvedValue([{
    taskId: TASK, name: 'Ship Atlas', projectId: 'p1', projectName: 'Aeon', columnName: 'Live', priority: 'high', ageDays: 24,
  }])
  vi.mocked(listRecentlyCompletedTasks).mockResolvedValue([])
  vi.mocked(listRecentlyCreatedTasks).mockResolvedValue([])
  vi.mocked(listBoardDayPages).mockResolvedValue([])
  vi.mocked(createKairosAskMemory).mockResolvedValue('ask-new')
})

afterEach(() => { vi.useRealTimers() })

describe('ask_mine handler — plan', () => {
  it.each(['03:00', '04:28', '05:00'])('plans nothing at %s (window closed) without a DB read', async (hhmm) => {
    expect(await askMineHandler.plan(USER, at(hhmm))).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(aether.alreadyRanToday).not.toHaveBeenCalled()
    expect(listOpenKairosAsks).not.toHaveBeenCalled()
  })

  it('plans one job with exactly the cron prompt, fed source ids and a 04:28Z deadline', async () => {
    const now = at('03:40')
    const [spec, ...rest] = await askMineHandler.plan(USER, now)
    expect(rest).toEqual([])
    expect(spec).toMatchObject({ kind: 'ask_mine', dominionId: null, externalKey: `ask_mine:${DAY}`, input: { maxOutputTokens: 4000 } })

    const dry = await runAskMineForUser(USER, { now, dryRun: true })
    if (dry.status !== 'dry_run') throw new Error(`expected dry_run, got ${dry.status}`)
    expect(spec.input.system).toBe(dry.modelInput.system)
    expect(spec.input.prompt).toBe(dry.modelInput.prompt)
    expect(new Set(spec.input.validMemoryIds)).toEqual(new Set([MEM, TASK]))
    expect(spec.input.context).toEqual({ date: DAY, validDominionIds: [DOM], aetherMemoryId: AETHER })
    expect(new Date(now.getTime() + spec.deadlineMinutes * 60_000).toISOString()).toBe('2026-10-01T04:28:00.000Z')
  })

  it('waits for tonight\'s aether until 03:30, then plans on whatever exists', async () => {
    // Before 03:30 without today's aether: wait (the 03:15 fallback may still run).
    vi.mocked(aether.alreadyRanToday).mockResolvedValue(false)
    expect(await askMineHandler.plan(USER, at('03:20'))).toEqual([])
    expect(listOpenKairosAsks).not.toHaveBeenCalled()
    // From 03:30 plan on whatever aether exists.
    expect(await askMineHandler.plan(USER, at('03:30'))).toHaveLength(1)
    // Today's aether already in: plan straight away.
    vi.mocked(aether.alreadyRanToday).mockResolvedValue(true)
    expect(await askMineHandler.plan(USER, at('03:20'))).toHaveLength(1)
  })

  it('skips an existing key, the cheap gates, and a night with no signals (the cron nudge covers it)', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValueOnce(true)
    expect(await askMineHandler.plan(USER, at('03:40'))).toEqual([])

    vi.mocked(getConversationState).mockResolvedValueOnce({ lastOutbound: null, replied: false, awaitingReply: true, replyRate7d: 0 })
    expect(await askMineHandler.plan(USER, at('03:40'))).toEqual([])

    silenceSignals()
    expect(await askMineHandler.plan(USER, at('03:40'))).toEqual([])
    expect(listBoardDayPages).not.toHaveBeenCalled()
    expect(createKairosAskMemory).not.toHaveBeenCalled()
  })
})

describe('ask_mine handler — apply', () => {
  it('persists the selected ask through the shared write path and writes the ok trace', async () => {
    const res = await askMineHandler.apply(jobRow(), answer(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['ask-new'], output: { answeredBy: 'routine' } })
    expect(createKairosAskMemory).toHaveBeenCalledWith(USER, expect.objectContaining({
      question: candidate.question,
      aetherMemoryId: AETHER,
      externalId: `ask-mine:${DAY}:1`,
      askMine: expect.objectContaining({ date: DAY, kind: 'decision', sourceMemoryIds: [MEM] }),
    }))
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'ask-mine', outcome: 'ok' })
    expect(getProviderForTask).not.toHaveBeenCalled()
  })

  it('drops ungrounded candidates and dedups against asks made since planning', async () => {
    const ungrounded = { ...candidate, sourceMemoryIds: ['invented'] }
    vi.mocked(listRecentKairosAsks).mockResolvedValue([priorAsk({ askMine: { date: '2026-09-29', kind: 'revival', sourceMemoryIds: [MEM], leverage: 0.7 } })])
    const res = await askMineHandler.apply(jobRow(), answer([ungrounded, candidate], [critique, { ...critique, candidateIndex: 1 }]), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: [], output: { skipped: 'no_candidate', answeredBy: 'routine' } })
    expect(listRecentKairosAsks).toHaveBeenCalled()
    expect(createKairosAskMemory).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'ask-mine', outcome: 'skipped', skipReason: 'no_candidate' })
  })

  it('accepts an empty candidate list but rejects non-JSON or wrongly shaped answers', async () => {
    expect(await askMineHandler.apply(jobRow(), answer([], []), 'routine')).toMatchObject({ ok: true, memoryIds: [] })

    const garbage = await askMineHandler.apply(jobRow(), 'I could not find a question worth asking.', 'routine')
    expect(garbage).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: /) })
    const shapeless = await askMineHandler.apply(jobRow(), '{"questions":[]}', 'routine')
    expect(shapeless).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed: /) })
    expect(createKairosAskMemory).not.toHaveBeenCalled()
  })

  it('rejects a stale job and one whose ask was already mined today', async () => {
    const stale = jobRow({ input: { ...jobRow().input, context: { date: '2026-09-30', validDominionIds: [DOM], aetherMemoryId: null } } })
    expect(await askMineHandler.apply(stale, answer(), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^stale_job/) })

    vi.mocked(listRecentKairosAsks).mockResolvedValue([priorAsk({ askMine: { date: DAY, kind: 'decision', sourceMemoryIds: [], leverage: 0.5 } })])
    expect(await askMineHandler.apply(jobRow(), answer(), 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^already_ran/) })
    expect(createKairosAskMemory).not.toHaveBeenCalled()
  })

  it('completes without an ask when the open-ask backlog filled up since planning (the cron would skip too)', async () => {
    const open = Array.from({ length: 10 }, (_, i) => ({ ...priorAsk({ id: `open-${i}` }), seq: i + 1 }))
    vi.mocked(listOpenKairosAsks).mockResolvedValue(open)
    const res = await askMineHandler.apply(jobRow(), answer(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: [], output: { skipped: 'backlog_full', answeredBy: 'routine' } })
    expect(createKairosAskMemory).not.toHaveBeenCalled()
    expect(writeCronSuccessTrace).toHaveBeenCalledWith(USER, { cronName: 'ask-mine', outcome: 'skipped', skipReason: 'backlog_full' })
  })

  it('still asks when one question is already open (below the cap)', async () => {
    vi.mocked(listOpenKairosAsks).mockResolvedValue([{ ...priorAsk({ id: 'open-1' }), seq: 1 }])
    const res = await askMineHandler.apply(jobRow(), answer(), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: [expect.any(String)] })
    expect(createKairosAskMemory).toHaveBeenCalledTimes(1)
  })

  it('fallback defers to the 04:30 cron', async () => {
    expect(await askMineHandler.fallback(jobRow())).toEqual({ ok: false, reason: 'deferred to the 04:30 UTC ask-mine cron' })
  })
})
