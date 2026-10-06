import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/mission-check', () => ({
  listMissionCheckCandidates: vi.fn(),
  writeMissionCheck: vi.fn(),
}))
vi.mock('@/lib/data/checklist', () => ({ findChecklistItems: vi.fn() }))
vi.mock('@/lib/data/projects', () => ({ touchProject: vi.fn() }))

import { listMissionCheckCandidates, writeMissionCheck, type MissionCheckCandidate } from '@/lib/data/mission-check'
import { findChecklistItems } from '@/lib/data/checklist'
import { touchProject } from '@/lib/data/projects'
import { routineAllows } from '@/lib/kairos/routines/catalog'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { PLANNED_THINKING_KINDS, SWEEP_PLAN_SKIP_KINDS } from '../queue'
import { MISSION_CHECK_CAP, missionCheckHandler, missionCheckKey } from '../handlers/mission-check'

const USER = 'user-1'
const NOW = new Date('2026-10-06T20:00:00Z')

const candidate = (sessionId: string, over: Partial<MissionCheckCandidate> = {}): MissionCheckCandidate => ({
  sessionId,
  taskId: `t-${sessionId}`,
  projectId: 'p-1',
  engine: 'claude',
  repo: 'aeon',
  endedAt: NOW,
  cardName: 'Add export button',
  description: 'Export the board as CSV.',
  cardMetadata: { hangar: { sessionIds: [sessionId], lastResult: { status: 'completed', summary: 'Added a CSV export button.', tests: { status: 'passed', summary: '12 passed' } } } },
  ...over,
})

const ITEMS = [
  { title: 'Button on toolbar', groupName: 'General', state: 'checked', completed: true },
  { title: 'Unit tests', groupName: 'QA', state: 'unchecked', completed: false },
]

function job(over: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-1', userId: USER, kind: 'mission_check', dominionId: null, externalKey: 'mission_check:s-1', status: 'claimed',
    input: {
      system: 's', prompt: 'p',
      context: { v: 1, sessionId: 's-1', taskId: 't-s-1', projectId: 'p-1', checklist: [{ h: 'C1', title: 'Button on toolbar' }, { h: 'C2', title: 'Unit tests' }] },
    },
    output: null, claimedBy: null, claimToken: null, claimedAt: null, deadlineAt: NOW, completedAt: null,
    attempts: 0, error: null, createdAt: NOW, updatedAt: NOW,
    ...over,
  }
}

const answer = '```json\n' + JSON.stringify({
  verdict: 'partly_done',
  reasons: ['The button is described', 'No tests for export are mentioned'],
  unmet: ['C2', 'C9', 'c2'],
  note: 'Looks mostly there, tests are unclear.',
}) + '\n```'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_MISSION_CHECK', 'on')
  vi.mocked(listMissionCheckCandidates).mockResolvedValue([candidate('s-1')])
  vi.mocked(findChecklistItems).mockResolvedValue(ITEMS as never)
  vi.mocked(writeMissionCheck).mockResolvedValue('written')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('mission_check wiring', () => {
  it('is a deep brain kind planned by claims and the hourly sweep', () => {
    expect(PLANNED_THINKING_KINDS).toContain('mission_check')
    expect(SWEEP_PLAN_SKIP_KINDS).not.toContain('mission_check')
    expect(routineAllows('brain', 'mission_check')).toBe(true)
  })
})

describe('mission_check plan', () => {
  it('switched off → no jobs and no candidate scan', async () => {
    vi.stubEnv('KAIROS_MISSION_CHECK', '0')
    expect(await missionCheckHandler.plan(USER, NOW)).toEqual([])
    expect(listMissionCheckCandidates).not.toHaveBeenCalled()
  })

  it('one job per finished mission with a per-session key and the card checklist', async () => {
    const [spec, ...rest] = await missionCheckHandler.plan(USER, NOW)
    expect(rest).toEqual([])
    expect(listMissionCheckCandidates).toHaveBeenCalledWith(USER, new Date(NOW.getTime() - 48 * 3600_000), MISSION_CHECK_CAP)
    expect(findChecklistItems).toHaveBeenCalledWith('t-s-1', 'p-1')
    expect(spec.kind).toBe('mission_check')
    expect(spec.externalKey).toBe('mission_check:s-1')
    expect(spec.externalKey).toBe(missionCheckKey('s-1'))
    expect(spec.input.validMemoryIds).toEqual([])
    expect(spec.input.prompt).toContain('C2 [unchecked] (QA): Unit tests')
    expect(spec.input.prompt).toContain('Added a CSV export button.')
    expect(spec.input.prompt).toContain('Tests: passed — 12 passed')
    expect(spec.input.system).toContain('cannot see the code')
    expect(spec.input.context).toMatchObject({ sessionId: 's-1', taskId: 't-s-1', projectId: 'p-1' })
  })

  it('caps the batch even if the data layer returns more', async () => {
    vi.mocked(listMissionCheckCandidates).mockResolvedValue(Array.from({ length: MISSION_CHECK_CAP + 3 }, (_, i) => candidate(`s-${i}`)))
    const specs = await missionCheckHandler.plan(USER, NOW)
    expect(specs).toHaveLength(MISSION_CHECK_CAP)
    expect(new Set(specs.map((s) => s.externalKey)).size).toBe(MISSION_CHECK_CAP)
  })

  it('observe mode still plans', async () => {
    vi.stubEnv('KAIROS_MISSION_CHECK', 'observe')
    expect(await missionCheckHandler.plan(USER, NOW)).toHaveLength(1)
  })
})

describe('mission_check apply', () => {
  it('writes a grounded advisory verdict and refreshes the board — nothing else', async () => {
    const out = await missionCheckHandler.apply(job(), answer, 'routine')
    expect(out).toEqual({ ok: true, memoryIds: [], output: { verdict: 'partly_done', unmet: 1, mode: 'on', answeredBy: 'routine' } })
    expect(writeMissionCheck).toHaveBeenCalledTimes(1)
    const [arg] = vi.mocked(writeMissionCheck).mock.calls[0]
    expect(arg).toEqual({
      projectId: 'p-1',
      taskId: 't-s-1',
      userId: USER,
      check: {
        sessionId: 's-1',
        verdict: 'partly_done',
        reasons: ['The button is described', 'No tests for export are mentioned'],
        unmet: ['Unit tests'],
        note: 'Looks mostly there, tests are unclear.',
        checkedAt: expect.any(String),
        mode: 'on',
      },
    })
    expect(Object.keys(arg)).not.toContain('columnId')
    expect(touchProject).toHaveBeenCalledWith('p-1', { type: 'task:updated' })
  })

  it('stores the mode so observe verdicts stay hidden', async () => {
    vi.stubEnv('KAIROS_MISSION_CHECK', 'observe')
    await missionCheckHandler.apply(job(), answer, 'routine')
    expect(vi.mocked(writeMissionCheck).mock.calls[0][0].check.mode).toBe('observe')
  })

  it('skips without a board bump when the write is refused or stale', async () => {
    vi.mocked(writeMissionCheck).mockResolvedValue('denied')
    expect(await missionCheckHandler.apply(job(), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'denied' } })
    vi.mocked(writeMissionCheck).mockResolvedValue('switched_off')
    expect(await missionCheckHandler.apply(job(), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'switched_off' } })
    expect(touchProject).not.toHaveBeenCalled()
  })

  it('writes nothing when switched off since planning', async () => {
    vi.stubEnv('KAIROS_MISSION_CHECK', 'off')
    expect(await missionCheckHandler.apply(job(), answer, 'routine')).toMatchObject({ ok: true, output: { skipped: 'mode_off' } })
    expect(writeMissionCheck).not.toHaveBeenCalled()
  })

  it('rejects bad answers and malformed jobs without writing', async () => {
    expect(await missionCheckHandler.apply(job(), 'sorry, no', 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    const badVerdict = '```json\n{"verdict":"merged","reasons":[],"unmet":[],"note":""}\n```'
    expect(await missionCheckHandler.apply(job(), badVerdict, 'routine')).toMatchObject({ ok: false })
    expect(await missionCheckHandler.apply(job({ input: { system: 's', prompt: 'p' } }), answer, 'routine')).toMatchObject({ ok: false, reason: expect.stringMatching(/^bad_job/) })
    expect(writeMissionCheck).not.toHaveBeenCalled()
  })

  it('has no paid fallback', async () => {
    expect(await missionCheckHandler.fallback(job())).toMatchObject({ ok: false })
  })
})
