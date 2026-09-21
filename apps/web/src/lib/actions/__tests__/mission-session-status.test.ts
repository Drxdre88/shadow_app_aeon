import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({ requireAuth: vi.fn(), requireMemberAccess: vi.fn() }))
vi.mock('@/lib/data/sessions', () => ({ findMissionSessionStatus: vi.fn() }))
vi.mock('@/lib/kairos/spawn', () => ({ dispatchSpawn: vi.fn() }))

import { requireMemberAccess } from '@/lib/actions/helpers'
import { findMissionSessionStatus } from '@/lib/data/sessions'
import { getMissionSessionStatusAction } from '../sessions'

const input = {
  sessionId: '20000000-0000-4000-8000-000000000001',
  projectId: '40000000-0000-4000-8000-000000000001',
  taskId: '30000000-0000-4000-8000-000000000001',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireMemberAccess).mockResolvedValue({ userId: 'another-member', role: 'viewer' } as never)
})

describe('shared mission session status', () => {
  it('allows a different project member to read narrowly scoped status', async () => {
    const status = { id: input.sessionId, projectId: input.projectId, taskId: input.taskId, status: 'running' }
    vi.mocked(findMissionSessionStatus).mockResolvedValue(status as never)
    expect(await getMissionSessionStatusAction(input)).toEqual(status)
    expect(requireMemberAccess).toHaveBeenCalledWith(input.projectId)
    expect(findMissionSessionStatus).toHaveBeenCalledWith(input.sessionId, input.projectId, input.taskId)
  })

  it('rejects nonmembers before reading any session', async () => {
    vi.mocked(requireMemberAccess).mockRejectedValue(new Error('Not a member'))
    await expect(getMissionSessionStatusAction(input)).rejects.toThrow('Not a member')
    expect(findMissionSessionStatus).not.toHaveBeenCalled()
  })

  it('rejects sessions outside the specified card and project', async () => {
    vi.mocked(findMissionSessionStatus).mockResolvedValue(null)
    await expect(getMissionSessionStatusAction(input)).rejects.toThrow('Mission session not found')
  })

  it('rejects malformed identifiers before access or query', async () => {
    await expect(getMissionSessionStatusAction({ ...input, taskId: '' })).rejects.toThrow()
    expect(requireMemberAccess).not.toHaveBeenCalled()
    expect(findMissionSessionStatus).not.toHaveBeenCalled()
  })
})
