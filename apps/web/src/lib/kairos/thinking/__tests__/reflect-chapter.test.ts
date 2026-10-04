import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalRecord } from '@/lib/data/goals'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn(), listJobs: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listRecentMemories: vi.fn(), captureMemory: vi.fn() }))
vi.mock('@/lib/data/goals', () => ({ listOpenGoals: vi.fn() }))
vi.mock('@/lib/data/kairos-promises', async (importOriginal) => ({ ...(await importOriginal<object>()), readKairosPromises: vi.fn() }))
vi.mock('@/lib/data/life-chapters', () => ({ listLifeChapters: vi.fn() }))
vi.mock('@/lib/kairos/today', () => ({
  todayEnabled: vi.fn(() => true),
  loadTodayDigest: vi.fn(async () => null),
  appendTodayNotes: vi.fn(async () => undefined),
  countTodayEntriesSince: vi.fn(async () => 3),
}))

import { hasJobWithKeyLike, listJobs } from '@/lib/data/thinking-jobs'
import { listRecentMemories } from '@/lib/data/memories'
import { listOpenGoals } from '@/lib/data/goals'
import { readKairosPromises } from '@/lib/data/kairos-promises'
import { listLifeChapters } from '@/lib/data/life-chapters'
import { reflectHandler } from '../handlers/reflect'
import { buildReflectPrompt, type ReflectPromptInputs } from '@/lib/kairos/cadence/reflect-prompt'

// Life-chapter continuity in the reflect prompt (KAIROS_LIFE_CHAPTERS=1 only).
// off / observe: the plan reads no chapter and the prompt is byte-identical.

const USER = 'user-1'
const NOW = new Date('2026-10-01T10:40:00.000Z')
const EVENT = { id: 'mem-ev-1', title: 'Captured session: pricing refactor', createdAt: NOW, streamClass: 'execution' }
const GOAL = {
  id: 'goal-1', title: 'Goal 1', type: 'kairos_goal', dominionId: null, archivedAt: null, createdAt: NOW,
  meta: { state: 'active', question: 'Why do pricing cards stall?', dueAt: null },
} as unknown as GoalRecord
const CHAPTER_ROW = {
  id: 'mem-chapter', externalKey: 'life_chapter:2026-09', createdAt: NOW,
  chapter: {
    v: 1, month: '2026-09', window: { start: 'a', end: 'b' }, title: 'The month auth stalled', summary: 'Billing shipped; auth did not.',
    turningPoints: [], whatChanged: [], unresolved: ['Auth still open'], citations: ['goal-1'], inputCounts: {}, lintHits: 31337, jobId: 'j', answeredBy: 'routine',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_DAYTIME_THINKING = '1'
  delete process.env.KAIROS_LIFE_CHAPTERS
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(listJobs).mockResolvedValue([])
  vi.mocked(listOpenGoals).mockResolvedValue([GOAL])
  vi.mocked(listRecentMemories).mockResolvedValue([EVENT] as never)
  vi.mocked(readKairosPromises).mockResolvedValue({ v: 1, nextSeq: 1, open: [], closed: [] } as never)
  vi.mocked(listLifeChapters).mockResolvedValue([CHAPTER_ROW] as never)
})
afterEach(() => {
  delete process.env.KAIROS_DAYTIME_THINKING
  delete process.env.KAIROS_LIFE_CHAPTERS
})

async function planSpec() {
  const [spec] = await reflectHandler.plan(USER, NOW)
  return spec
}

describe('reflect + life chapters', () => {
  it('off and observe: no chapter read, prompt and ids byte-identical', async () => {
    const baseline = await planSpec()
    expect(baseline.input.prompt).not.toContain('Where your story stands')
    process.env.KAIROS_LIFE_CHAPTERS = 'observe'
    const observed = await planSpec()
    expect(observed.input.prompt).toBe(baseline.input.prompt)
    expect(observed.input.system).toBe(baseline.input.system)
    expect(observed.input.validMemoryIds).toEqual(baseline.input.validMemoryIds)
    expect(listLifeChapters).not.toHaveBeenCalled()
  })

  it('mode 1: the last chapter appears as context, never as a citable id, without lintHits', async () => {
    const baseline = await planSpec()
    process.env.KAIROS_LIFE_CHAPTERS = '1'
    const spec = await planSpec()
    expect(listLifeChapters).toHaveBeenCalledWith(USER, { limit: 1 })
    expect(spec.input.prompt).toContain('## Where your story stands (your last chapter — your own words, context not evidence; never cite)')
    expect(spec.input.prompt).toContain('September 2026 — The month auth stalled')
    expect(spec.input.prompt).toContain('Still open: Auth still open')
    expect(spec.input.prompt).not.toContain('31337')
    expect(spec.input.prompt).not.toContain('mem-chapter')
    expect(spec.input.validMemoryIds).toEqual(baseline.input.validMemoryIds)
    expect(spec.input.validMemoryIds).not.toContain('mem-chapter')
  })

  it('mode 1 with no chapter yet or a failing read: prompt unchanged', async () => {
    const baseline = await planSpec()
    process.env.KAIROS_LIFE_CHAPTERS = '1'
    vi.mocked(listLifeChapters).mockResolvedValueOnce([])
    expect((await planSpec()).input.prompt).toBe(baseline.input.prompt)
    vi.mocked(listLifeChapters).mockRejectedValueOnce(new Error('db down'))
    expect((await planSpec()).input.prompt).toBe(baseline.input.prompt)
  })

  it('buildReflectPrompt without `chapter` is byte-identical to before', () => {
    const base: ReflectPromptInputs = {
      londonTime: '11:40', since: '10:40 London', todaySection: '', events: [], goals: [], promises: [], reflectionsToday: 0,
    }
    const withUndefined = buildReflectPrompt({ ...base, chapter: undefined })
    expect(withUndefined).toBe(buildReflectPrompt(base))
    expect(buildReflectPrompt(base)).not.toContain('Where your story stands')
    expect(buildReflectPrompt({ ...base, chapter: 'X' })).toContain('## Where your story stands')
  })
})
