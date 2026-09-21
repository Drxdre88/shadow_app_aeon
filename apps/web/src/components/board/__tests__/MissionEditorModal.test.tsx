/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MissionEditorModal } from '../MissionEditorModal'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useHangarUiStore } from '@/lib/store/hangarUiStore'
import { listProjectHangarRepos, saveCardMission, spawnSessionFromCard } from '@/lib/actions/hangar'

vi.mock('@/lib/actions/hangar', () => ({
  listProjectHangarRepos: vi.fn(),
  saveCardMission: vi.fn(),
  spawnSessionFromCard: vi.fn(),
}))

vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

const PROJECT = 'project-1'
const TASK = 'task-1'

const missionTask = (hangar: Record<string, unknown> = {}): BoardTask => ({
  id: TASK,
  projectId: PROJECT,
  name: 'Research the repository',
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  metadata: { hangar },
})

const validMission = {
  objective: 'recon',
  repo: 'aeon',
  agent: 'copilot',
  model: '',
  instruction: 'Map the repository launch path',
  autoRun: false,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setTask(hangar: Record<string, unknown> = validMission) {
  useBoardStore.setState({ tasks: [missionTask(hangar)] })
  useHangarUiStore.setState({ missionEditorTaskId: TASK })
}

async function openEditor(hangar: Record<string, unknown> = validMission, waitForRepos = true) {
  setTask(hangar)
  render(<MissionEditorModal projectId={PROJECT} />)
  await waitFor(() => expect(screen.getByText(/Agent mission — Research the repository/)).toBeTruthy())
  if (waitForRepos) {
    await waitFor(() => expect(screen.getByRole('option', { name: 'Aeon (aeon)' })).toBeTruthy())
  }
}

const saveButton = () => screen.getByRole('button', { name: /^Save draft$/ }) as HTMLButtonElement
const launchButton = () => screen.getByRole('button', { name: /Save & Launch/ }) as HTMLButtonElement
const modelSelect = () => screen.getByRole('combobox', { name: 'Model' }) as HTMLSelectElement

beforeEach(() => {
  vi.mocked(listProjectHangarRepos).mockResolvedValue([
    { slug: 'aeon', name: 'Aeon', allowedEngines: ['copilot'] },
  ])
  vi.mocked(saveCardMission).mockResolvedValue(validMission as never)
  vi.mocked(spawnSessionFromCard).mockResolvedValue({ id: 'session-1' } as never)
  useHangarUiStore.setState({ projectId: PROJECT, missionEditorTaskId: null })
  useBoardStore.setState({ tasks: [], isDirty: false, lastMutatedAt: 123 })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MissionEditorModal launch contract', () => {
  it('Save persists the mission without launching and closes only after success', async () => {
    const save = deferred<typeof validMission>()
    vi.mocked(saveCardMission).mockReturnValue(save.promise as never)
    await openEditor()

    fireEvent.click(saveButton())
    expect(saveCardMission).toHaveBeenCalledOnce()
    expect(spawnSessionFromCard).not.toHaveBeenCalled()
    expect(useHangarUiStore.getState().missionEditorTaskId).toBe(TASK)

    await act(async () => save.resolve(validMission))
    await waitFor(() => expect(useHangarUiStore.getState().missionEditorTaskId).toBeNull())
    expect(spawnSessionFromCard).not.toHaveBeenCalled()
  })

  it('Save & Launch waits for persistence, launches exactly once, then closes', async () => {
    const save = deferred<typeof validMission>()
    vi.mocked(saveCardMission).mockReturnValue(save.promise as never)
    await openEditor()

    fireEvent.click(launchButton())
    fireEvent.click(launchButton())
    expect(saveCardMission).toHaveBeenCalledOnce()
    expect(spawnSessionFromCard).not.toHaveBeenCalled()

    await act(async () => save.resolve(validMission))
    await waitFor(() => expect(spawnSessionFromCard).toHaveBeenCalledOnce())
    expect(spawnSessionFromCard).toHaveBeenCalledWith(PROJECT, TASK)
    await waitFor(() => expect(useHangarUiStore.getState().missionEditorTaskId).toBeNull())
    const hangar = useBoardStore.getState().tasks[0].metadata?.hangar as Record<string, unknown>
    expect(hangar.sessionIds).toEqual(['session-1'])
    expect(hangar.autoRun).toBe(false)
    expect(useBoardStore.getState().isDirty).toBe(false)
    expect(useBoardStore.getState().lastMutatedAt).toBe(123)
  })

  it('allows saving a draft while launch requires repo and instruction', async () => {
    await openEditor({ objective: 'recon', agent: 'copilot', repo: '', instruction: '' })
    expect(saveButton().disabled).toBe(false)
    expect(launchButton().disabled).toBe(true)

    const repository = screen.getByRole('combobox', { name: 'Repository' })
    const instruction = screen.getByRole('textbox', { name: 'Instruction' })
    fireEvent.change(repository, { target: { value: 'aeon' } })
    fireEvent.change(instruction, { target: { value: '   ' } })
    expect(saveButton().disabled).toBe(false)
    expect(launchButton().disabled).toBe(true)

    fireEvent.change(instruction, { target: { value: 'Inspect the launch flow' } })
    expect(saveButton().disabled).toBe(false)
    expect(launchButton().disabled).toBe(false)
  })

  it('persists an incomplete draft without spawning a session', async () => {
    const incomplete = { ...validMission, repo: '', instruction: 'Research scope to be decided' }
    vi.mocked(saveCardMission).mockResolvedValue(incomplete as never)
    await openEditor(incomplete)
    expect(launchButton().disabled).toBe(true)
    fireEvent.click(saveButton())
    await waitFor(() => expect(useHangarUiStore.getState().missionEditorTaskId).toBeNull())
    expect(saveCardMission).toHaveBeenCalledWith(PROJECT, TASK, expect.objectContaining({
      repo: '', instruction: incomplete.instruction, autoRun: false,
    }))
    expect(spawnSessionFromCard).not.toHaveBeenCalled()
    expect(useBoardStore.getState().tasks[0].metadata?.hangar).toEqual(expect.objectContaining(incomplete))
  })

  it('disables engines excluded by the selected repository', async () => {
    await openEditor()
    await waitFor(() => expect(screen.getByRole('button', { name: 'codex' })).toHaveProperty('disabled', true))
    expect(screen.getByRole('button', { name: 'claude' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'copilot' })).toHaveProperty('disabled', false)
  })

  it('persists the exact selected model id', async () => {
    await openEditor()

    fireEvent.change(modelSelect(), { target: { value: 'gpt-5.6-sol' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(saveCardMission).toHaveBeenCalledOnce())
    expect(saveCardMission).toHaveBeenCalledWith(PROJECT, TASK, expect.objectContaining({ model: 'gpt-5.6-sol' }))
  })

  it('persists runner default as null', async () => {
    await openEditor({ ...validMission, model: 'gpt-5.6-sol' })

    fireEvent.change(modelSelect(), { target: { value: '' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(saveCardMission).toHaveBeenCalledOnce())
    expect(saveCardMission).toHaveBeenCalledWith(PROJECT, TASK, expect.objectContaining({ model: null }))
  })

  it('reopens an unknown model as custom and persists the edited id', async () => {
    await openEditor({ ...validMission, model: 'account-preview-model' })

    expect(modelSelect().value).toBe('__custom__')
    const customModel = screen.getByRole('textbox', { name: 'Custom model ID' }) as HTMLInputElement
    expect(customModel.value).toBe('account-preview-model')
    fireEvent.change(customModel, { target: { value: 'account-preview-model-v2' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(saveCardMission).toHaveBeenCalledOnce())
    expect(saveCardMission).toHaveBeenCalledWith(
      PROJECT,
      TASK,
      expect.objectContaining({ model: 'account-preview-model-v2' })
    )
  })

  it('keeps a compatible preset across engines and resets an incompatible preset', async () => {
    vi.mocked(listProjectHangarRepos).mockResolvedValue([
      { slug: 'aeon', name: 'Aeon', allowedEngines: ['copilot', 'claude', 'codex'] },
    ])
    await openEditor({ ...validMission, model: 'gpt-5.6-sol' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'codex' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'codex' }))
    expect(modelSelect().value).toBe('gpt-5.6-sol')

    fireEvent.click(screen.getByRole('button', { name: 'claude' }))
    expect(modelSelect().value).toBe('')
  })

  it('resets a custom model when the engine changes', async () => {
    vi.mocked(listProjectHangarRepos).mockResolvedValue([
      { slug: 'aeon', name: 'Aeon', allowedEngines: ['copilot', 'codex'] },
    ])
    await openEditor({ ...validMission, model: 'account-preview-model' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'codex' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: 'codex' }))

    expect(modelSelect().value).toBe('')
    expect(screen.queryByRole('textbox', { name: 'Custom model ID' })).toBeNull()
  })

  it('blocks saving while a custom model id is empty', async () => {
    await openEditor()

    fireEvent.change(modelSelect(), { target: { value: '__custom__' } })

    expect(screen.getByRole('textbox', { name: 'Custom model ID' })).toHaveProperty('value', '')
    expect(saveButton().disabled).toBe(true)
    expect(launchButton().disabled).toBe(true)
  })

  it('blocks saving when the stored engine is not allowed by the repository', async () => {
    await openEditor({ ...validMission, agent: 'claude', model: 'claude-sonnet-5' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'claude' })).toHaveProperty('disabled', true))
    expect(saveButton().disabled).toBe(true)
    expect(launchButton().disabled).toBe(true)
  })

  it('keeps Save available but holds Launch while repositories are loading', async () => {
    const lookup = deferred<Array<{ slug: string; name: string; allowedEngines: string[] }>>()
    vi.mocked(listProjectHangarRepos).mockReturnValue(lookup.promise)
    await openEditor(validMission, false)

    expect(saveButton().disabled).toBe(false)
    expect(launchButton().disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'copilot' })).toHaveProperty('disabled', false)

    await act(async () => lookup.resolve([
      { slug: 'aeon', name: 'Aeon', allowedEngines: ['copilot'] },
    ]))
    await waitFor(() => expect(launchButton().disabled).toBe(false))
    expect(screen.getByRole('button', { name: 'claude' })).toHaveProperty('disabled', true)
  })

  it('keeps Save available, holds Launch and shows an error when repository lookup fails', async () => {
    vi.mocked(listProjectHangarRepos).mockRejectedValue(new Error('Registry unavailable'))
    await openEditor(validMission, false)

    await waitFor(() => expect(screen.getByText(/Could not load Hangar repositories/)).toBeTruthy())
    expect(saveButton().disabled).toBe(false)
    expect(launchButton().disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'copilot' })).toHaveProperty('disabled', false)
  })

  it('rejects a custom model id the server would refuse', async () => {
    await openEditor()

    fireEvent.change(modelSelect(), { target: { value: '__custom__' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom model ID' }), { target: { value: '-rf bad model' } })

    expect(screen.getByText(/Model IDs use letters/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: 'Custom model ID' }), { target: { value: 'gpt-5.6-sol' } })
    expect(screen.queryByText(/Model IDs use letters/)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('falls back to copilot when the stored engine is not a known engine', async () => {
    await openEditor({ ...validMission, agent: 'gemini' })

    await waitFor(() => expect(screen.getByRole('button', { name: 'copilot' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'copilot' }).className).toContain('text-[var(--primary)]')
  })

  it('keeps the editor open and never launches when persistence rejects', async () => {
    vi.mocked(saveCardMission).mockRejectedValue(new Error('Mission payload rejected'))
    await openEditor()

    fireEvent.click(launchButton())
    await waitFor(() => expect(saveCardMission).toHaveBeenCalledOnce())
    await waitFor(() => expect(launchButton().disabled).toBe(false))
    expect(spawnSessionFromCard).not.toHaveBeenCalled()
    expect(useHangarUiStore.getState().missionEditorTaskId).toBe(TASK)
  })

  it('keeps the editor open when launch rejects after a successful save', async () => {
    vi.mocked(spawnSessionFromCard).mockRejectedValue(new Error('Runner unavailable'))
    await openEditor()

    fireEvent.click(launchButton())
    await waitFor(() => expect(spawnSessionFromCard).toHaveBeenCalledOnce())
    await waitFor(() => expect(launchButton().disabled).toBe(false))
    expect(saveCardMission).toHaveBeenCalledOnce()
    expect(useHangarUiStore.getState().missionEditorTaskId).toBe(TASK)
  })
})
