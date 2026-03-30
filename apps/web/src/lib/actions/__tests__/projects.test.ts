import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZodError } from 'zod'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/actions/helpers', () => ({
  requireAuth: vi.fn(),
  requireOwnership: vi.fn(),
  requireEditor: vi.fn(),
}))

vi.mock('@/lib/data/projects', () => ({
  findProjects: vi.fn(),
  findProjectsWithStats: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  setProjectGroup: vi.fn(),
  renameGroup: vi.fn(),
}))

vi.mock('@/lib/data/columns', () => ({
  createDefaultColumns: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOwnership, requireEditor } from '@/lib/actions/helpers'
import {
  findProjects,
  findProjectsWithStats,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
  setProjectGroup as _setProjectGroup,
  renameGroup,
} from '@/lib/data/projects'
import { createDefaultColumns } from '@/lib/data/columns'
import {
  getProjects,
  getProjectsWithStats,
  setProjectGroup,
  renameProjectGroup,
  createProject,
  updateProject,
  deleteProject,
} from '@/lib/actions/projects'

const mockRequireAuth = vi.mocked(requireAuth)
const mockRequireOwnership = vi.mocked(requireOwnership)
const mockRequireEditor = vi.mocked(requireEditor)
const mockFindProjects = vi.mocked(findProjects)
const mockFindProjectsWithStats = vi.mocked(findProjectsWithStats)
const mockCreateProject = vi.mocked(_createProject)
const mockUpdateProject = vi.mocked(_updateProject)
const mockDeleteProject = vi.mocked(_deleteProject)
const mockSetProjectGroup = vi.mocked(_setProjectGroup)
const mockRenameGroup = vi.mocked(renameGroup)
const mockCreateDefaultColumns = vi.mocked(createDefaultColumns)
const mockRevalidatePath = vi.mocked(revalidatePath)

const VALID_START = '2025-01-01'
const VALID_END = '2025-12-31'

const stubProject = {
  id: 'proj-1',
  name: 'Test Project',
  userId: 'user-1',
  description: null as string | null,
  timeScale: 'week',
  startDate: new Date(VALID_START),
  endDate: new Date(VALID_END),
  settings: {} as unknown,
  group: null as string | null,
  planetImage: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue('user-1')
  mockRequireOwnership.mockResolvedValue('user-1')
  mockRequireEditor.mockResolvedValue('user-1')
})

describe('getProjects', () => {
  it('returns projects for authenticated user', async () => {
    const projects = [stubProject]
    mockFindProjects.mockResolvedValue(projects)

    const result = await getProjects()

    expect(mockRequireAuth).toHaveBeenCalledOnce()
    expect(mockFindProjects).toHaveBeenCalledWith('user-1')
    expect(result).toEqual(projects)
  })

  it('throws when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))

    await expect(getProjects()).rejects.toThrow('Unauthorized')
    expect(mockFindProjects).not.toHaveBeenCalled()
  })
})

describe('getProjectsWithStats', () => {
  it('returns projects with stats for authenticated user', async () => {
    const projectsWithStats = [{ ...stubProject, totalTasks: 5, doneTasks: 2, completionPct: 40 }]
    mockFindProjectsWithStats.mockResolvedValue(projectsWithStats)

    const result = await getProjectsWithStats()

    expect(mockRequireAuth).toHaveBeenCalledOnce()
    expect(mockFindProjectsWithStats).toHaveBeenCalledWith('user-1')
    expect(result).toEqual(projectsWithStats)
  })

  it('throws when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))

    await expect(getProjectsWithStats()).rejects.toThrow('Unauthorized')
    expect(mockFindProjectsWithStats).not.toHaveBeenCalled()
  })
})

describe('setProjectGroup', () => {
  it('sets group for project', async () => {
    mockSetProjectGroup.mockResolvedValue(undefined)

    await setProjectGroup('proj-1', 'design')

    expect(mockRequireEditor).toHaveBeenCalledWith('proj-1')
    expect(mockSetProjectGroup).toHaveBeenCalledWith('proj-1', 'design')
  })

  it('sets group to null to remove from group', async () => {
    mockSetProjectGroup.mockResolvedValue(undefined)

    await setProjectGroup('proj-1', null)

    expect(mockSetProjectGroup).toHaveBeenCalledWith('proj-1', null)
  })

  it('throws when not editor', async () => {
    mockRequireEditor.mockRejectedValue(new Error('Viewers cannot modify this project'))

    await expect(setProjectGroup('proj-1', 'design')).rejects.toThrow(
      'Viewers cannot modify this project',
    )
    expect(mockSetProjectGroup).not.toHaveBeenCalled()
  })
})

describe('renameProjectGroup', () => {
  it('renames group for authenticated user', async () => {
    mockRenameGroup.mockResolvedValue(undefined)

    await renameProjectGroup('old-name', 'new-name')

    expect(mockRequireAuth).toHaveBeenCalledOnce()
    expect(mockRenameGroup).toHaveBeenCalledWith('user-1', 'old-name', 'new-name')
  })

  it('throws when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))

    await expect(renameProjectGroup('old-name', 'new-name')).rejects.toThrow('Unauthorized')
    expect(mockRenameGroup).not.toHaveBeenCalled()
  })
})

describe('createProject', () => {
  const validInput = {
    name: 'New Project',
    startDate: VALID_START,
    endDate: VALID_END,
  }

  it('creates project with valid data', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    const result = await createProject(validInput)

    expect(mockRequireAuth).toHaveBeenCalledOnce()
    expect(mockCreateProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: 'New Project', timeScale: 'week' }),
    )
    expect(result).toEqual(stubProject)
  })

  it('creates default columns after project creation', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    await createProject(validInput)

    expect(mockCreateDefaultColumns).toHaveBeenCalledWith('proj-1', undefined)
  })

  it('passes template to createDefaultColumns', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    await createProject({ ...validInput, template: 'kanban' })

    expect(mockCreateDefaultColumns).toHaveBeenCalledWith('proj-1', 'kanban')
  })

  it('defaults timeScale to week when not provided', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    await createProject(validInput)

    expect(mockCreateProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ timeScale: 'week' }),
    )
  })

  it('uses provided timeScale when given', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    await createProject({ ...validInput, timeScale: 'month' })

    expect(mockCreateProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ timeScale: 'month' }),
    )
  })

  it('throws ZodError on empty name', async () => {
    await expect(createProject({ ...validInput, name: '' })).rejects.toThrow(ZodError)
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('throws ZodError on invalid startDate', async () => {
    await expect(
      createProject({ ...validInput, startDate: 'not-a-date' }),
    ).rejects.toThrow(ZodError)
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('throws ZodError on invalid endDate', async () => {
    await expect(
      createProject({ ...validInput, endDate: 'not-a-date' }),
    ).rejects.toThrow(ZodError)
    expect(mockCreateProject).not.toHaveBeenCalled()
  })

  it('revalidates dashboard path after creation', async () => {
    mockCreateProject.mockResolvedValue(stubProject)
    mockCreateDefaultColumns.mockResolvedValue(undefined)

    await createProject(validInput)

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('throws when not authenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('Unauthorized'))

    await expect(createProject(validInput)).rejects.toThrow('Unauthorized')
    expect(mockCreateProject).not.toHaveBeenCalled()
  })
})

describe('updateProject', () => {
  const validUpdate = { name: 'Updated Name' }

  it('updates project with valid partial data', async () => {
    const updated = { ...stubProject, name: 'Updated Name' }
    mockUpdateProject.mockResolvedValue(updated)

    const result = await updateProject('proj-1', validUpdate)

    expect(mockRequireEditor).toHaveBeenCalledWith('proj-1')
    expect(mockUpdateProject).toHaveBeenCalledWith('proj-1', 'user-1', expect.objectContaining({ name: 'Updated Name' }))
    expect(result).toEqual(updated)
  })

  it('strips unknown fields via updateProjectSchema validation', async () => {
    mockUpdateProject.mockResolvedValue(stubProject)

    await updateProject('proj-1', { name: 'Clean Name' } as any)

    const passedData = mockUpdateProject.mock.calls[0][2]
    expect(passedData).not.toHaveProperty('unknownField')
  })

  it('revalidates both dashboard and project paths', async () => {
    mockUpdateProject.mockResolvedValue(stubProject)

    await updateProject('proj-1', validUpdate)

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/project/proj-1')
  })

  it('throws when not editor', async () => {
    mockRequireEditor.mockRejectedValue(new Error('Viewers cannot modify this project'))

    await expect(updateProject('proj-1', validUpdate)).rejects.toThrow(
      'Viewers cannot modify this project',
    )
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })

  it('throws ZodError on invalid update data', async () => {
    await expect(
      updateProject('proj-1', { name: '' } as any),
    ).rejects.toThrow(ZodError)
    expect(mockUpdateProject).not.toHaveBeenCalled()
  })
})

describe('deleteProject', () => {
  it('deletes project for owner', async () => {
    mockDeleteProject.mockResolvedValue(true)

    await deleteProject('proj-1')

    expect(mockRequireOwnership).toHaveBeenCalledWith('proj-1')
    expect(mockDeleteProject).toHaveBeenCalledWith('proj-1', 'user-1')
  })

  it('throws when _deleteProject returns falsy', async () => {
    mockDeleteProject.mockResolvedValue(false)

    await expect(deleteProject('proj-1')).rejects.toThrow(
      'Only project owners can delete projects',
    )
  })

  it('throws when not authenticated', async () => {
    mockRequireOwnership.mockRejectedValue(new Error('Unauthorized'))

    await expect(deleteProject('proj-1')).rejects.toThrow('Unauthorized')
    expect(mockDeleteProject).not.toHaveBeenCalled()
  })

  it('revalidates dashboard path after deletion', async () => {
    mockDeleteProject.mockResolvedValue(true)

    await deleteProject('proj-1')

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('does not revalidate when deletion fails', async () => {
    mockDeleteProject.mockResolvedValue(false)

    await expect(deleteProject('proj-1')).rejects.toThrow()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})
