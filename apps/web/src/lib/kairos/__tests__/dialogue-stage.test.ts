import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// prepare_dialogue_context carries the stage block (spec_stage §2) through the
// real loadStageBlock over a mocked stage store: '' with KAIROS_STAGE unset,
// the rendered block with KAIROS_STAGE=1.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/ask', () => ({ getOpenKairosAskById: vi.fn(), markKairosAskAnswered: vi.fn(), getPriorAethers: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ captureReflection: vi.fn() }))
vi.mock('@/lib/data/dialogue', () => ({
  createDialogue: vi.fn(), findOpenDialogueForAsk: vi.fn(), loadDialogue: vi.fn(), appendDialogueTurn: vi.fn(),
  closeDialogue: vi.fn(), fetchMemoriesByIds: vi.fn(async () => []), fetchAetherPayload: vi.fn(),
  writeFloatingReflection: vi.fn(), filterLiveDominionIds: vi.fn(),
}))
vi.mock('../retrieve', () => ({ retrieveContext: vi.fn() }))
vi.mock('../today', () => ({ loadTodayDigest: vi.fn(async () => null), recordTodayAfter: vi.fn() }))
vi.mock('@/lib/data/kairos-stage', () => ({ readKairosStage: vi.fn() }))

import { loadDialogue } from '@/lib/data/dialogue'
import { readKairosStage } from '@/lib/data/kairos-stage'
import { prepareDialogueContext } from '../dialogue'
import { STAGE_BLOCK_BEGIN } from '../stage/render'
import { emptyStageState } from '../stage/select'

const USER = 'user-1'
const THREAD = 't0000000-0000-4000-8000-000000000002'

beforeEach(() => {
  vi.clearAllMocks()
  const now = new Date().toISOString()
  vi.mocked(readKairosStage).mockResolvedValue({
    ...emptyStageState(),
    updatedAt: now,
    coalitions: [{
      id: 'c_00000001', text: 'Billing migration is slipping', cites: [],
      components: { importance: 0.8, surprise: 0.6, goalRelevance: 0.5, need: 0.5 },
      mass: 0.9, massAt: now, firstAt: now, wins: 0, deepBacked: true, members: [],
    }],
  } as never)
  vi.mocked(loadDialogue).mockResolvedValue({
    thread: {
      id: THREAD, userId: USER, dominionId: null, title: 'Topic', status: 'running', createdAt: new Date(),
      seed: { kind: 'kairos-dialogue', kairosAskId: null, aetherMemoryId: null, sourceThoughtId: null, sourceMemoryIds: [] },
    },
    turns: [],
  } as never)
})
afterEach(() => {
  delete process.env.KAIROS_STAGE
})

describe('prepareDialogueContext — stage', () => {
  it('KAIROS_STAGE unset: stage is "" and the store is never read', async () => {
    const ctx = await prepareDialogueContext(USER, THREAD)
    expect(ctx!.stage).toBe('')
    expect(readKairosStage).not.toHaveBeenCalled()
  })

  it('KAIROS_STAGE=observe: no injection', async () => {
    process.env.KAIROS_STAGE = 'observe'
    expect((await prepareDialogueContext(USER, THREAD))!.stage).toBe('')
  })

  it('KAIROS_STAGE=1: the rendered block, fenced and id-free', async () => {
    process.env.KAIROS_STAGE = '1'
    const ctx = await prepareDialogueContext(USER, THREAD)
    expect(readKairosStage).toHaveBeenCalledWith(USER)
    expect(ctx!.stage).toContain(STAGE_BLOCK_BEGIN)
    expect(ctx!.stage).toContain('I, now: Billing migration is slipping')
    expect(ctx!.stage).not.toContain('c_00000001')
  })

  it('a failing store read degrades to "" (never throws)', async () => {
    process.env.KAIROS_STAGE = '1'
    vi.mocked(readKairosStage).mockRejectedValue(new Error('corrupt'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await prepareDialogueContext(USER, THREAD))!.stage).toBe('')
  })
})
