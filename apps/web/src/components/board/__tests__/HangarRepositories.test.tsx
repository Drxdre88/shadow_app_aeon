/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HangarRepositories } from '../HangarRepositories'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import {
  addProjectHangarRepository,
  editProjectHangarRepository,
  getProjectHangarRepositoryRegistry,
} from '@/lib/actions/hangar-repositories'

vi.mock('@/lib/actions/hangar-repositories', () => ({
  addProjectHangarRepository: vi.fn(),
  editProjectHangarRepository: vi.fn(),
  getProjectHangarRepositoryRegistry: vi.fn(),
}))

const PROJECT = 'project-1'
const REALM_A = 'realm-a'
const REALM_B = 'realm-b'

const registry = {
  realms: [
    { id: REALM_A, name: 'Operations', canManage: true },
    { id: REALM_B, name: 'Research', canManage: false },
  ],
  repositories: [
    {
      id: 'repo-a',
      realmId: REALM_A,
      realmName: 'Operations',
      canManage: true,
      slug: 'aeon',
      name: 'Aeon',
      gitUrl: 'https://github.com/example/aeon.git',
      defaultBranch: 'main',
      allowedEngines: ['copilot'],
      active: true,
    },
    {
      id: 'repo-b',
      realmId: REALM_B,
      realmName: 'Research',
      canManage: false,
      slug: 'swarm',
      name: 'Swarm',
      gitUrl: 'https://github.com/example/swarm.git',
      defaultBranch: 'develop',
      allowedEngines: [],
      active: false,
    },
  ],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

async function openRegistry() {
  render(<HangarRepositories projectId={PROJECT} />)
  fireEvent.click(screen.getByRole('button', { name: 'Repositories' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Hangar repositories' })).toBeTruthy())
}

async function openAddForm() {
  await openRegistry()
  await waitFor(() => expect(screen.getByText('Aeon')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hydra' } })
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'hydra' } })
  fireEvent.change(screen.getByLabelText('Default branch'), { target: { value: 'develop' } })
  fireEvent.change(screen.getByLabelText('Git URL'), { target: { value: 'https://github.com/example/hydra.git' } })
}

beforeEach(() => {
  useHangarUiStore.setState({
    projectId: PROJECT,
    config: { enabled: true, triggerColumnId: null },
    missionEditorTaskId: null,
  })
  vi.mocked(getProjectHangarRepositoryRegistry).mockResolvedValue(registry)
  vi.mocked(addProjectHangarRepository).mockResolvedValue(undefined)
  vi.mocked(editProjectHangarRepository).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HangarRepositories', () => {
  it('only appears for the Hangar-enabled project held by the UI store', () => {
    useHangarUiStore.setState({ projectId: 'another-project' })
    const { rerender } = render(<HangarRepositories projectId={PROJECT} />)
    expect(screen.queryByRole('button', { name: 'Repositories' })).toBeNull()

    useHangarUiStore.setState({ projectId: PROJECT, config: { enabled: false, triggerColumnId: null } })
    rerender(<HangarRepositories projectId={PROJECT} />)
    expect(screen.queryByRole('button', { name: 'Repositories' })).toBeNull()
  })

  it('loads on open and keeps the loading state visible until the registry arrives', async () => {
    const request = deferred<typeof registry>()
    vi.mocked(getProjectHangarRepositoryRegistry).mockReturnValue(request.promise)

    await openRegistry()
    expect(screen.getByRole('status').textContent).toContain('Loading repositories')

    await act(async () => request.resolve(registry))
    await waitFor(() => expect(screen.getByText('Aeon')).toBeTruthy())
    expect(screen.getByText('Swarm')).toBeTruthy()
  })

  it('shows a recoverable error when loading fails', async () => {
    vi.mocked(getProjectHangarRepositoryRegistry).mockRejectedValueOnce(new Error('Registry unavailable'))
    await openRegistry()

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Registry unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByText('Aeon')).toBeTruthy())
    expect(getProjectHangarRepositoryRegistry).toHaveBeenCalledTimes(2)
  })

  it('shows multi-realm repositories and makes the target realm explicit when adding', async () => {
    await openRegistry()
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy())
    expect(screen.getByText('Research')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    const realm = screen.getByRole('combobox', { name: 'Realm' })
    expect(within(realm).getByRole('option', { name: 'Operations' })).toBeTruthy()
    expect(within(realm).queryByRole('option', { name: 'Research' })).toBeNull()
    expect(screen.getByText(/runner must also have this repository configured/i)).toBeTruthy()
  })

  it('offers edit and retire controls only for realms the caller can manage', async () => {
    await openRegistry()
    await waitFor(() => expect(screen.getByText('Aeon')).toBeTruthy())

    expect(screen.getByRole('button', { name: 'Edit Aeon' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retire Aeon' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit Swarm' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restore Swarm' })).toBeNull()
  })

  it('submits the exact add payload and reloads the registry after success', async () => {
    await openAddForm()
    fireEvent.click(screen.getByLabelText('claude'))
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))

    await waitFor(() => expect(addProjectHangarRepository).toHaveBeenCalledWith(PROJECT, {
      realmId: REALM_A,
      name: 'Hydra',
      slug: 'hydra',
      gitUrl: 'https://github.com/example/hydra.git',
      defaultBranch: 'develop',
      allowedEngines: ['claude'],
    }))
    await waitFor(() => expect(getProjectHangarRepositoryRegistry).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: 'Add repository' })).toBeNull()
  })

  it('holds an add with a slug that mission cards cannot target', async () => {
    await openAddForm()
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'my repo' } })

    expect(screen.getByText(/safe path segments/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add repository' })).toHaveProperty('disabled', true)
    expect(addProjectHangarRepository).not.toHaveBeenCalled()
  })

  it('submits the exact edit payload and reloads the registry after success', async () => {
    await openRegistry()
    await waitFor(() => expect(screen.getByText('Aeon')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Edit Aeon' }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Aeon Agent OS' } })
    fireEvent.change(screen.getByLabelText('Default branch'), { target: { value: 'stable' } })
    fireEvent.click(screen.getByLabelText('codex'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(editProjectHangarRepository).toHaveBeenCalledWith(PROJECT, 'repo-a', {
      name: 'Aeon Agent OS',
      slug: 'aeon',
      gitUrl: 'https://github.com/example/aeon.git',
      defaultBranch: 'stable',
      allowedEngines: ['copilot', 'codex'],
    }))
    await waitFor(() => expect(getProjectHangarRepositoryRegistry).toHaveBeenCalledTimes(2))
  })

  it('retires and restores a repository with narrow active-only patches', async () => {
    const retired = {
      ...registry,
      repositories: registry.repositories.map((repo) => repo.id === 'repo-a' ? { ...repo, active: false } : repo),
    }
    vi.mocked(getProjectHangarRepositoryRegistry)
      .mockResolvedValueOnce(registry)
      .mockResolvedValueOnce(retired)
      .mockResolvedValueOnce(registry)

    await openRegistry()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retire Aeon' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Retire Aeon' }))

    await waitFor(() => expect(editProjectHangarRepository).toHaveBeenNthCalledWith(1, PROJECT, 'repo-a', { active: false }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore Aeon' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Restore Aeon' }))

    await waitFor(() => expect(editProjectHangarRepository).toHaveBeenNthCalledWith(2, PROJECT, 'repo-a', { active: true }))
    await waitFor(() => expect(getProjectHangarRepositoryRegistry).toHaveBeenCalledTimes(3))
  })

  it('keeps a rejected add editable and allows a successful retry', async () => {
    vi.mocked(addProjectHangarRepository)
      .mockRejectedValueOnce(new Error('Slug already exists'))
      .mockResolvedValueOnce(undefined)
    await openAddForm()

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Slug already exists'))
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Hydra')

    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))
    await waitFor(() => expect(addProjectHangarRepository).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(getProjectHangarRepositoryRegistry).toHaveBeenCalledTimes(2))
  })
})
