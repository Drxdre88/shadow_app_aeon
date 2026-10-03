import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

// KAIROS_STAGE=1 + KAIROS_IDEA_NOVELTY=1: the stage block is prepended at claim, the stones stay inside the data block.

vi.mock('@/lib/data/thinking-jobs', () => ({
  upsertJob: vi.fn(),
  claimNextJob: vi.fn(),
  findJobById: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  releaseForFallback: vi.fn(),
  expireOverdue: vi.fn(async () => []),
  listPendingFallbacks: vi.fn(async () => []),
  hasJobWithKeyLike: vi.fn(),
  recordFallback: vi.fn(async () => ({})),
  listJobs: vi.fn(),
  mergeJobOutput: vi.fn(async () => true),
}))
vi.mock('@/lib/kairos/thinking/registry', () => ({ getThinkingHandlers: () => [] }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'off' }))
vi.mock('@/lib/data/kairos-stage', () => ({ readKairosStage: vi.fn(), mutateKairosStage: vi.fn() }))
vi.mock('@/lib/kairos/stage/ambient', () => ({ gatherAmbient: vi.fn(async () => []) }))
vi.mock('@/lib/data/idea-taste', () => ({
  listSteppingStones: vi.fn(async () => [{ title: 'Kill standups', claim: 'Stop the daily standup.', reason: 'owner_dismissed' }]),
  readIdeaTasteProfile: vi.fn(),
  stampIdeaOutcomeBy: vi.fn(),
}))

import { claimNextJob } from '@/lib/data/thinking-jobs'
import { readKairosStage } from '@/lib/data/kairos-stage'
import { applyStagePost, emptyStageState } from '@/lib/kairos/stage/select'
import { claimThinkingJob } from '@/lib/kairos/thinking/queue'
import { steppingExtension } from '@/lib/kairos/thinking/handlers/idea-ext/stepping'
import { IDEA_GENERATE_SYSTEM_PROMPT, buildIdeaGeneratePrompt, ideaInputIds, type IdeaGenerateInputs } from '../../generate-prompt'
import { IDEA_DATA_BEGIN, IDEA_DATA_END } from '../../prompt-data'
import { NOVELTY_ROUND_ADDENDUM } from '../novelty-prompt'

const USER = 'user-1'
const DAY = '2026-10-04'
const NOW = new Date(`${DAY}T04:00:00Z`)
const TOKEN = '33333333-3333-4333-8333-333333333333'
const thought = { text: 'Audit prep needs a plan', importance: 0.9, surprise: 0.6, goalRelevance: 0.5, need: 0.5 }

const inputs: IdeaGenerateInputs = {
  date: DAY,
  dominions: [{ id: 'dom-1', name: 'Aeon' }],
  objectives: [],
  aether: null,
  board: [],
  beliefs: [],
  concepts: [],
  reflections: [{ id: 'refl-1', title: 'Tired', summary: 'too many tabs', excerpt: null, createdAt: new Date('2026-10-03T10:00:00Z') }],
  lessons: [],
  directionStats: [],
}

function jobOf(input: ThinkingJobRow['input']): ThinkingJobRow {
  return {
    id: 'job-gen', userId: USER, kind: 'idea_generate', dominionId: null, externalKey: `idea_generate:${DAY}`, status: 'claimed',
    input, output: null, claimedBy: 'routine', claimToken: TOKEN, claimedAt: NOW, deadlineAt: new Date(NOW.getTime() + 3_600_000),
    completedAt: null, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KAIROS_STAGE', '1')
  vi.stubEnv('KAIROS_IDEA_NOVELTY', '1')
  vi.stubEnv('KAIROS_IDEA_NOVELTY_EVERY', '')
  const stage = applyStagePost(emptyStageState(), {
    post: { kind: 'reflect', source: 'job', tier: 'deep', jobId: 'seed', items: [thought] },
  }, new Date()).state!
  vi.mocked(readKairosStage).mockResolvedValue(stage)
})
afterEach(() => vi.unstubAllEnvs())

describe('novelty round + stage', () => {
  it('serves stage block first, stones inside the data markers, system untouched by the stage', async () => {
    const planned = await steppingExtension.planGenerate!({
      system: IDEA_GENERATE_SYSTEM_PROMPT,
      prompt: buildIdeaGeneratePrompt(inputs),
      validMemoryIds: ideaInputIds(inputs),
      context: { date: DAY, dominions: inputs.dominions, inputErrors: [] },
    }, { userId: USER, now: NOW, day: DAY, dominions: inputs.dominions, errors: [], inputs })
    vi.mocked(claimNextJob).mockResolvedValue(jobOf({ system: planned.system, prompt: planned.prompt, validMemoryIds: planned.validMemoryIds, context: planned.context }))

    const served = (await claimThinkingJob(USER, { kinds: ['idea_generate'] })).job!
    expect(served.system).toBe(`${IDEA_GENERATE_SYSTEM_PROMPT}\n${NOVELTY_ROUND_ADDENDUM}`)
    expect(served.prompt.startsWith('## Stage')).toBe(true)
    expect(served.prompt.endsWith(planned.prompt)).toBe(true)
    const begin = served.prompt.indexOf(IDEA_DATA_BEGIN)
    const stones = served.prompt.indexOf('## Stepping stones')
    const end = served.prompt.indexOf(IDEA_DATA_END)
    expect(served.prompt.indexOf('Audit prep needs a plan')).toBeLessThan(begin)
    expect(begin).toBeLessThan(stones)
    expect(stones).toBeLessThan(end)
    expect(served.prompt.split(IDEA_DATA_END)).toHaveLength(2)
  })
})
