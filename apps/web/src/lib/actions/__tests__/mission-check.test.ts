import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({ requireMember: vi.fn(), requireOwner: vi.fn() }))
vi.mock('@/lib/data/mission-check', () => ({
  findMissionCheckBoard: vi.fn(),
  setProjectMissionCheck: vi.fn(),
}))

import { requireMember, requireOwner } from '@/lib/actions/helpers'
import { findMissionCheckBoard, setProjectMissionCheck } from '@/lib/data/mission-check'
import { getMissionCheckSetting, setMissionCheck } from '@/lib/actions/mission-check'

const P = 'proj-1'
const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireMember).mockResolvedValue(OWNER)
  vi.mocked(requireOwner).mockResolvedValue(OWNER)
})

describe('mission check switch', () => {
  it('reports the state and whether this caller created the board', async () => {
    vi.mocked(findMissionCheckBoard).mockResolvedValue({ id: P, userId: OWNER, settings: { kairosMissionCheck: true } })
    expect(await getMissionCheckSetting(P)).toEqual({ on: true, canToggle: true, available: false })
    vi.mocked(requireMember).mockResolvedValue('editor-2')
    expect(await getMissionCheckSetting(P)).toEqual({ on: true, canToggle: false, available: false })
    vi.mocked(findMissionCheckBoard).mockResolvedValue({ id: P, userId: OWNER, settings: { kairosMissionCheck: 'on' } })
    expect((await getMissionCheckSetting(P)).on).toBe(false)
  })

  it('switches through the owner guard and the creator-scoped writer', async () => {
    vi.mocked(setProjectMissionCheck).mockResolvedValue({ id: P, settings: { kairosMissionCheck: true } })
    expect(await setMissionCheck(P, true)).toEqual({ projectId: P, on: true })
    expect(requireOwner).toHaveBeenCalledWith(P)
    expect(setProjectMissionCheck).toHaveBeenCalledWith(P, OWNER, true)
  })

  it('refuses viewers and editors before any write', async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error('Only the project owner can change this'))
    await expect(setMissionCheck(P, true)).rejects.toThrow('Only the project owner')
    expect(setProjectMissionCheck).not.toHaveBeenCalled()
  })

  it('refuses a realm owner who did not create the board', async () => {
    vi.mocked(setProjectMissionCheck).mockResolvedValue(null as never)
    await expect(setMissionCheck(P, true)).rejects.toThrow('Only the person who created this board')
  })

  it('validates input', async () => {
    await expect(setMissionCheck(P, 'yes' as never)).rejects.toThrow(ZodError)
  })
})
