import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({
  requireAuth: vi.fn(),
  requireMember: vi.fn(),
  requireOwner: vi.fn(),
}))
vi.mock('@/lib/data/project-archive', () => ({
  findArchivedProjects: vi.fn(),
  findProjectArchiveInfo: vi.fn(),
  setProjectArchivedForOwner: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { requireAuth, requireMember, requireOwner } from '@/lib/actions/helpers'
import { findArchivedProjects, findProjectArchiveInfo, setProjectArchivedForOwner } from '@/lib/data/project-archive'
import { getArchivedProjects, getProjectArchiveSetting, setProjectArchived } from '@/lib/actions/project-archive'

const P = 'proj-1'
const CREATOR = 'user-creator'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(CREATOR)
  vi.mocked(requireMember).mockResolvedValue(CREATOR)
  vi.mocked(requireOwner).mockResolvedValue(CREATOR)
})

describe('getProjectArchiveSetting', () => {
  it('reports the state and lets only the creator toggle', async () => {
    vi.mocked(findProjectArchiveInfo).mockResolvedValue({
      id: P, userId: CREATOR, settings: { archived: true, archivedAt: '2026-10-07T10:00:00.000Z' },
    })
    expect(await getProjectArchiveSetting(P)).toEqual({ archived: true, archivedAt: '2026-10-07T10:00:00.000Z', canToggle: true })
    vi.mocked(requireMember).mockResolvedValue('member-2')
    expect(await getProjectArchiveSetting(P)).toEqual({ archived: true, archivedAt: '2026-10-07T10:00:00.000Z', canToggle: false })
  })

  it('reads a board with no archive keys as live', async () => {
    vi.mocked(findProjectArchiveInfo).mockResolvedValue({ id: P, userId: CREATOR, settings: { boardMode: 'hangar' } })
    expect(await getProjectArchiveSetting(P)).toEqual({ archived: false, archivedAt: null, canToggle: true })
  })
})

describe('setProjectArchived', () => {
  it('archives through the owner guard and the creator-scoped writer, then revalidates', async () => {
    vi.mocked(setProjectArchivedForOwner).mockResolvedValue({ id: P, settings: { archived: true } })
    expect(await setProjectArchived(P, true)).toEqual({ projectId: P, archived: true })
    expect(requireOwner).toHaveBeenCalledWith(P)
    expect(setProjectArchivedForOwner).toHaveBeenCalledWith(P, CREATOR, true)
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith(`/project/${P}`)
  })

  it('rejects an editor at the owner guard without writing', async () => {
    vi.mocked(requireOwner).mockRejectedValue(new Error('Only the project owner can change this'))
    await expect(setProjectArchived(P, true)).rejects.toThrow('Only the project owner')
    expect(setProjectArchivedForOwner).not.toHaveBeenCalled()
  })

  it('refuses a realm/co-owner who did not create the board', async () => {
    vi.mocked(requireOwner).mockResolvedValue('realm-owner')
    vi.mocked(setProjectArchivedForOwner).mockResolvedValue(null)
    await expect(setProjectArchived(P, false)).rejects.toThrow('Only the person who created this board can archive it')
    expect(setProjectArchivedForOwner).toHaveBeenCalledWith(P, 'realm-owner', false)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('validates the flag as a boolean', async () => {
    await expect(setProjectArchived(P, 'yes' as unknown as boolean)).rejects.toBeInstanceOf(ZodError)
    expect(setProjectArchivedForOwner).not.toHaveBeenCalled()
  })
})

describe('getArchivedProjects', () => {
  it('lists the signed-in user’s archived boards', async () => {
    const rows = [{ id: P, name: 'Old', archivedAt: '2026-10-07T10:00:00.000Z' }]
    vi.mocked(findArchivedProjects).mockResolvedValue(rows)
    expect(await getArchivedProjects()).toEqual(rows)
    expect(findArchivedProjects).toHaveBeenCalledWith(CREATOR)
  })
})
