import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-stage', () => ({ readKairosStage: vi.fn(), mutateKairosStage: vi.fn() }))
vi.mock('../ambient', () => ({ gatherAmbient: vi.fn(async () => []) }))

import { mutateKairosStage, readKairosStage } from '@/lib/data/kairos-stage'
import { gatherAmbient } from '../ambient'
import { loadStageBlock, postStageCandidates, stageMode, stageSurpriseDue } from '../index'
import { applyStagePost, emptyStageState } from '../select'
import type { KairosStageState } from '../types'

const NOW = new Date('2026-10-03T09:30:00.000Z')
const thought = { text: 'Billing migration is slipping', importance: 0.9, surprise: 0.8, goalRelevance: 0.5, need: 0.5 }
const job = { id: 'job-1', kind: 'reflect' as const, output: { stage: { cycle: '2026-10-03T10', given: ['c_12345678'] } } }

function seeded(): KairosStageState {
  return applyStagePost(emptyStageState(), { post: { kind: 'reflect', source: 'job', tier: 'deep', jobId: 'j0', items: [thought] } }, NOW).state!
}

// Run the real pure mutation against a given stored state.
function storeWith(state: KairosStageState) {
  vi.mocked(readKairosStage).mockResolvedValue(state)
  vi.mocked(mutateKairosStage).mockImplementation(async (_u, mutate) => mutate(state).result)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllEnvs())

describe('stageMode', () => {
  it.each([[undefined, 'off'], ['0', 'off'], ['observe', 'observe'], ['1', 'on'], ['yes', 'off']] as const)('KAIROS_STAGE=%s → %s', (raw, mode) => {
    if (raw === undefined) vi.stubEnv('KAIROS_STAGE', '')
    else vi.stubEnv('KAIROS_STAGE', raw)
    expect(stageMode()).toBe(mode)
  })
})

describe('loadStageBlock', () => {
  it('is empty and reads nothing unless the flag is on (observe included)', async () => {
    for (const v of ['', 'observe']) {
      vi.stubEnv('KAIROS_STAGE', v)
      expect(await loadStageBlock('u1', { now: NOW })).toEqual({ block: '', given: [], cycle: '2026-10-03T10' })
    }
    expect(readKairosStage).not.toHaveBeenCalled()
  })

  it('renders the stored stage when on, and never throws on a bad read', async () => {
    vi.stubEnv('KAIROS_STAGE', '1')
    storeWith(seeded())
    const res = await loadStageBlock('u1', { now: NOW })
    expect(res.block).toContain('I, now: Billing migration is slipping')
    expect(res.given).toHaveLength(1)
    vi.mocked(readKairosStage).mockRejectedValue(new Error('corrupt'))
    expect((await loadStageBlock('u1', { now: NOW })).block).toBe('')
  })
})

describe('stageSurpriseDue', () => {
  it('is false unless on; compares surprise since `since` with the threshold', async () => {
    storeWith(seeded())
    vi.stubEnv('KAIROS_STAGE', 'observe')
    expect(await stageSurpriseDue('u1', new Date(NOW.getTime() - 60_000), NOW)).toBe(false)
    vi.stubEnv('KAIROS_STAGE', '1')
    expect(await stageSurpriseDue('u1', new Date(NOW.getTime() - 60_000), NOW)).toBe(false)
    vi.stubEnv('KAIROS_STAGE_SURPRISE_THRESHOLD', '0.5')
    expect(await stageSurpriseDue('u1', new Date(NOW.getTime() - 60_000), NOW)).toBe(true)
    expect(await stageSurpriseDue('u1', NOW, NOW)).toBe(false)
  })
})

describe('postStageCandidates', () => {
  it('does nothing when off', async () => {
    vi.stubEnv('KAIROS_STAGE', '')
    expect(await postStageCandidates('u1', job, [thought], { now: NOW })).toMatchObject({ skipped: 'off' })
    expect(readKairosStage).not.toHaveBeenCalled()
  })

  it('posts in observe mode, gathering ambient facts before the transaction on rollover', async () => {
    vi.stubEnv('KAIROS_STAGE', 'observe')
    storeWith(emptyStageState())
    const res = await postStageCandidates('u1', job, [thought], { now: NOW })
    expect(res).toMatchObject({ posted: 1 })
    expect(gatherAmbient).toHaveBeenCalledWith('u1', NOW)
    expect(vi.mocked(gatherAmbient).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(mutateKairosStage).mock.invocationCallOrder[0])
  })

  it('skips ambient within the same cycle and a job already posted', async () => {
    vi.stubEnv('KAIROS_STAGE', '1')
    storeWith(seeded())
    await postStageCandidates('u1', job, [thought], { now: new Date(NOW.getTime() + 60_000) })
    expect(gatherAmbient).not.toHaveBeenCalled()
    const res = await postStageCandidates('u1', { ...job, id: 'j0' }, [thought], { now: NOW })
    expect(res.skipped).toBe('duplicate_job')
    expect(mutateKairosStage).toHaveBeenCalledTimes(1)
  })

  it('never throws: a failed write is reported as skipped', async () => {
    vi.stubEnv('KAIROS_STAGE', '1')
    vi.mocked(readKairosStage).mockResolvedValue(emptyStageState())
    vi.mocked(mutateKairosStage).mockRejectedValue(new Error('lock timeout'))
    expect(await postStageCandidates('u1', job, [thought], { now: NOW })).toMatchObject({ skipped: 'error' })
  })
})
