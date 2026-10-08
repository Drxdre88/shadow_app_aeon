import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({ requireMember: vi.fn(), requireOwner: vi.fn() }))
vi.mock('@/lib/data/ai-done', () => ({
  findAiDoneBoard: vi.fn(),
  setProjectAiDone: vi.fn(),
}))

import { requireMember, requireOwner } from '@/lib/actions/helpers'
import { findAiDoneBoard, setProjectAiDone } from '@/lib/data/ai-done'
import { getAiDoneSetting, setAiDone } from '@/lib/actions/ai-done'

const P = 'proj-1'
const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  vi.mocked(requireMember).mockResolvedValue(OWNER)
  vi.mocked(requireOwner).mockResolvedValue(OWNER)
})

describe('Vorath checks (AI DONE) switch', () => {
  it('reports the state, whether this caller created the board, and the mind switch', async () => {
    vi.stubEnv('KAIROS_AI_DONE', '0')
    vi.mocked(findAiDoneBoard).mockResolvedValue({ id: P, userId: OWNER, settings: { kairosAiDone: true } })
    expect(await getAiDoneSetting(P)).toEqual({ on: true, canToggle: true, available: false })
    vi.stubEnv('KAIROS_AI_DONE', '1')
    vi.mocked(requireMember).mockResolvedValue('editor-2')
    expect(await getAiDoneSetting(P)).toEqual({ on: true, canToggle: false, available: true })
    vi.mocked(findAiDoneBoard).mockResolvedValue({ id: P, userId: OWNER, settings: { kairosAiDone: 'on' } })
    expect((await getAiDoneSetting(P)).on).toBe(false)
  })

  it('switches through the owner guard and the creator-scoped writer', async () => {
    vi.mocked(setProjectAiDone).mockResolvedValue({ id: P, settings: { kairosAiDone: true } })
    expect(await setAiDone(P, true)).toEqual({ projectId: P, on: true })
    expect(requireOwner).toHaveBeenCalledWith(P)
    expect(setProjectAiDone).toHaveBeenCalledWith(P, OWNER, true)
  })

  it('refuses viewers and editors before any write', async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error('Only the project owner can change this'))
    await expect(setAiDone(P, true)).rejects.toThrow('Only the project owner')
    expect(setProjectAiDone).not.toHaveBeenCalled()
  })

  it('refuses a realm owner who did not create the board', async () => {
    vi.mocked(setProjectAiDone).mockResolvedValue(null as never)
    await expect(setAiDone(P, true)).rejects.toThrow('Only the person who created this board')
  })

  it('validates input', async () => {
    await expect(setAiDone(P, 'yes' as never)).rejects.toThrow(ZodError)
  })
})
