import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/data/dominion-focus', async () => {
  const { rankByActivity } = await vi.importActual<typeof import('@/lib/data/dominion-focus')>('@/lib/data/dominion-focus')
  return { rankByActivity, listLiveDominions: vi.fn(), setDominionPinned: vi.fn() }
})
vi.mock('@/lib/data/dominion-activity', () => ({ getUnattributedActivity: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))

import { revalidatePath } from 'next/cache'
import { requireAuth } from '../helpers'
import { listLiveDominions, setDominionPinned } from '@/lib/data/dominion-focus'
import { getUnattributedActivity } from '@/lib/data/dominion-activity'
import { getFocusOverview, setDominionPinnedAction } from '../dominion-focus'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const scoredAt = new Date('2026-10-05T01:10:00.000Z')

function row(over: Record<string, unknown>) {
  return {
    id: ID, userId: 'user-1', name: 'Area', color: 'purple', icon: null, sortOrder: 0, vision: null, missionLong: null,
    archivedAt: null, activityScore: 0, lastActiveAt: null, activityScoredAt: scoredAt, activity: null,
    focusState: 'active', pinned: false, createdAt: scoredAt, updatedAt: scoredAt, dormant: false, ...over,
  }
}

const savedMode = process.env.KAIROS_LIVING_DOMINIONS

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_LIVING_DOMINIONS = 'observe'
  vi.mocked(requireAuth).mockResolvedValue('user-1')
  vi.mocked(getUnattributedActivity).mockResolvedValue(null)
})

afterEach(() => {
  if (savedMode === undefined) delete process.env.KAIROS_LIVING_DOMINIONS
  else process.env.KAIROS_LIVING_DOMINIONS = savedMode
})

describe('getFocusOverview', () => {
  it('ranks by activity, serialises dates and normalises the breakdown', async () => {
    vi.mocked(listLiveDominions).mockResolvedValue([
      row({ id: 'a', name: 'Quiet', sortOrder: 0, activityScore: 1 }),
      row({
        id: 'b', name: 'Busy', sortOrder: 1, activityScore: 30, lastActiveAt: new Date('2026-10-04T10:00:00.000Z'),
        activity: { boards: [{ id: 'x', name: 'Board', score: 3 }], sessions: 4 },
      }),
    ] as never)
    vi.mocked(getUnattributedActivity).mockResolvedValue({ scoredAt: '2026-10-05T01:10:00.000Z', boards: [], repos: [{ slug: 'hydra', score: 2 }] })

    const out = await getFocusOverview()

    expect(listLiveDominions).toHaveBeenCalledWith('user-1')
    expect(getUnattributedActivity).toHaveBeenCalledWith('user-1')
    expect(out.mode).toBe('observe')
    expect(out.dominions.map((d) => d.name)).toEqual(['Busy', 'Quiet'])
    expect(out.dominions[0].lastActiveAt).toBe('2026-10-04T10:00:00.000Z')
    expect(out.dominions[0].activityScoredAt).toBe('2026-10-05T01:10:00.000Z')
    expect(out.dominions[0].activity).toMatchObject({ boards: [{ id: 'x' }], repos: [], sessions: 4, cardsFinished: 0, notes: 0 })
    expect(out.dominions[1].activity).toBeNull()
    expect(out.unattributed?.repos).toEqual([{ slug: 'hydra', score: 2 }])
    expect(() => JSON.stringify(out)).not.toThrow()
  })

  it('reports the off switch', async () => {
    delete process.env.KAIROS_LIVING_DOMINIONS
    vi.mocked(listLiveDominions).mockResolvedValue([])
    expect((await getFocusOverview()).mode).toBe('off')
  })

  it('requires a signed-in user', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(getFocusOverview()).rejects.toThrow('Unauthorized')
    expect(listLiveDominions).not.toHaveBeenCalled()
  })
})

describe('setDominionPinnedAction', () => {
  it('pins for the signed-in user and revalidates /vorath', async () => {
    vi.mocked(setDominionPinned).mockResolvedValue(row({ pinned: true, focusState: 'active' }) as never)
    const out = await setDominionPinnedAction({ dominionId: ID, pinned: true })
    expect(setDominionPinned).toHaveBeenCalledWith(ID, 'user-1', true)
    expect(out).toEqual({ dominionId: ID, pinned: true, focusState: 'active' })
    expect(revalidatePath).toHaveBeenCalledWith('/vorath')
  })

  it('rejects bad input before touching the data layer', async () => {
    await expect(setDominionPinnedAction({ dominionId: 'nope', pinned: true })).rejects.toThrow()
    await expect(setDominionPinnedAction({ dominionId: ID, pinned: 'yes' as never })).rejects.toThrow()
    expect(setDominionPinned).not.toHaveBeenCalled()
  })

  it("refuses someone else's area", async () => {
    vi.mocked(setDominionPinned).mockResolvedValue(null)
    await expect(setDominionPinnedAction({ dominionId: ID, pinned: false })).rejects.toThrow('Area not found or unauthorized')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
