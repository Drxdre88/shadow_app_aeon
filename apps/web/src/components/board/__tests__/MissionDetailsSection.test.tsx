/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMissionSessionStatusAction } from '@/lib/actions/sessions'
import { MissionDetailsSection } from '../MissionDetailsSection'

vi.mock('@/lib/actions/sessions', () => ({ getMissionSessionStatusAction: vi.fn() }))

const metadata = {
  hangar: {
    objective: 'recon',
    repo: 'aeon',
    agent: 'copilot',
    model: null,
    instruction: 'Read the architecture and inspect the mission card.',
    autoRun: false,
    sessionIds: ['session-current'],
    lastResult: { status: 'completed', summary: 'An older run produced a report.' },
  },
}

beforeEach(() => {
  vi.mocked(getMissionSessionStatusAction).mockResolvedValue({
    id: 'session-current',
    taskId: 'task-1',
    projectId: 'project-1',
    status: 'running',
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MissionDetailsSection', () => {
  it('uses the latest stored session for live status and marks cached output as previous', async () => {
    render(<MissionDetailsSection taskId="task-1" projectId="project-1" metadata={metadata} />)

    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())
    expect(getMissionSessionStatusAction).toHaveBeenCalledWith({ sessionId: 'session-current', projectId: 'project-1', taskId: 'task-1' })
    expect(screen.getByLabelText('Previous recorded result')).toBeTruthy()
    expect(screen.getByText('An older run produced a report.')).toBeTruthy()
    expect(screen.getByText('Runner default')).toBeTruthy()
  })

  it('keeps configure and launch discoverable', async () => {
    const onConfigure = vi.fn()
    render(<MissionDetailsSection taskId="task-1" projectId="project-1" metadata={metadata} onConfigure={onConfigure} />)
    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Configure / launch' }))
    expect(onConfigure).toHaveBeenCalledOnce()
  })

  it('keeps long instructions bounded until expanded', async () => {
    const longInstruction = `${'Detailed repository context. '.repeat(20)}FINAL SENTENCE`
    render(<MissionDetailsSection
      taskId="task-1"
      projectId="project-1"
      metadata={{ hangar: { ...metadata.hangar, instruction: longInstruction } }}
    />)

    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())
    expect(screen.queryByText(/FINAL SENTENCE/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show full instruction' }))
    expect(screen.getByText(/FINAL SENTENCE/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse instruction' })).toBeTruthy()
  })

  it('polls a live run until terminal and relabels the cached result', async () => {
    vi.useFakeTimers()
    vi.mocked(getMissionSessionStatusAction)
      .mockResolvedValueOnce({ id: 'session-current', taskId: 'task-1', projectId: 'project-1', status: 'queued' } as never)
      .mockResolvedValueOnce({ id: 'session-current', taskId: 'task-1', projectId: 'project-1', status: 'succeeded' } as never)

    render(<MissionDetailsSection taskId="task-1" projectId="project-1" metadata={metadata} />)
    await act(async () => {})
    expect(screen.getByText('queued')).toBeTruthy()
    expect(screen.getByLabelText('Previous recorded result')).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    expect(screen.getByText('succeeded')).toBeTruthy()
    expect(screen.getByLabelText('Last recorded result')).toBeTruthy()
    expect(getMissionSessionStatusAction).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(getMissionSessionStatusAction).toHaveBeenCalledTimes(2)
    cleanup()
    vi.useRealTimers()
  })

  it('refuses a session row that does not match the card and project', async () => {
    vi.mocked(getMissionSessionStatusAction).mockResolvedValue({
      id: 'session-current',
      taskId: 'another-task',
      projectId: 'project-1',
      status: 'running',
    } as never)
    render(<MissionDetailsSection taskId="task-1" projectId="project-1" metadata={metadata} />)
    await waitFor(() => expect(screen.getByText('Current run status unavailable.')).toBeTruthy())
    expect(screen.queryByText('running')).toBeNull()
  })

  it('renders nothing for a normal PM card and does not query sessions', () => {
    const { container } = render(<MissionDetailsSection taskId="task-1" projectId="project-1" metadata={{ note: true }} />)
    expect(container.innerHTML).toBe('')
    expect(getMissionSessionStatusAction).not.toHaveBeenCalled()
  })
})
