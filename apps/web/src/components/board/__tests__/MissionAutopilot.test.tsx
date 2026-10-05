/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerAndRelaunch, approvePlanAndBuild, createFollowUpCards, requeueMission, revisePlan } from '@/lib/actions/hangar-autopilot'
import { MissionAutopilotPanel } from '../MissionAutopilotPanel'
import { MissionResultSection } from '../MissionResultSection'

vi.mock('@/lib/actions/hangar-autopilot', () => ({
  requeueMission: vi.fn(),
  approvePlanAndBuild: vi.fn(),
  revisePlan: vi.fn(),
  answerAndRelaunch: vi.fn(),
  createFollowUpCards: vi.fn(),
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

const actions = { projectId: 'p-1', taskId: 't-1', canAnswer: true, canCreateFollowUps: true }

beforeEach(() => {
  vi.mocked(requeueMission).mockResolvedValue({ id: 'new' } as never)
  vi.mocked(approvePlanAndBuild).mockResolvedValue({ id: 'new' } as never)
  vi.mocked(revisePlan).mockResolvedValue({ id: 'new' } as never)
  vi.mocked(answerAndRelaunch).mockResolvedValue({ id: 'new' } as never)
  vi.mocked(createFollowUpCards).mockResolvedValue([{ id: 'c', name: 'Two' }] as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Answer & relaunch', () => {
  it('sends only the answered questions', async () => {
    render(<MissionResultSection actions={actions} result={{ status: 'needs_input', summary: 'Blocked.', questions: ['Which repo?', 'Which branch?'] }} />)
    const button = screen.getByRole('button', { name: /Answer & relaunch/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Answer to question 2'), { target: { value: ' main ' } })
    fireEvent.click(button)

    await waitFor(() => expect(answerAndRelaunch).toHaveBeenCalledWith('p-1', 't-1', [{ question: 'Which branch?', answer: 'main' }]))
  })

  it('stays read-only without actions', () => {
    render(<MissionResultSection result={{ status: 'needs_input', summary: 'Blocked.', questions: ['Which repo?'] }} />)
    expect(screen.queryByRole('button', { name: /Answer & relaunch/ })).toBeNull()
    expect(screen.getByText('Which repo?')).toBeTruthy()
  })
})

describe('Follow-ups to cards', () => {
  const result = {
    status: 'completed',
    summary: 'Done.',
    recommended_tasks: [
      { title: 'One', objective: 'implement', instruction: 'a' },
      { title: 'Two', objective: 'recon', instruction: 'b' },
    ],
  }

  it('creates cards for the chosen follow-ups and marks existing ones', async () => {
    render(<MissionResultSection actions={{ ...actions, createdFollowUps: ['One'] }} result={result} />)
    expect((screen.getByLabelText('Select follow-up: One') as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Select follow-up: Two'))
    fireEvent.click(screen.getByRole('button', { name: /Create mission cards/ }))

    await waitFor(() => expect(createFollowUpCards).toHaveBeenCalledWith('p-1', 't-1', [1]))
    await waitFor(() => expect(screen.getAllByText('Card created')).toHaveLength(2))
  })
})

describe('MissionAutopilotPanel', () => {
  it('offers Requeue for a timed-out run', async () => {
    render(<MissionAutopilotPanel projectId="p-1" taskId="t-1" mission={{}} latestSession={{ id: 's', status: 'timeout' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Requeue/ }))
    await waitFor(() => expect(requeueMission).toHaveBeenCalledWith('p-1', 't-1'))
  })

  it('shows the runner-offline flag only for the queued run it was raised on', () => {
    const mission = { stall: { kind: 'runner_offline', sessionId: 's', minutes: 30 } }
    const { rerender } = render(<MissionAutopilotPanel projectId="p-1" taskId="t-1" mission={mission} latestSession={{ id: 's', status: 'queued' }} />)
    expect(screen.getByRole('status').textContent).toContain('Runner offline')
    rerender(<MissionAutopilotPanel projectId="p-1" taskId="t-1" mission={mission} latestSession={{ id: 'other', status: 'queued' }} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('approves or revises a waiting plan', async () => {
    const mission = { planGate: { status: 'awaiting_approval' } }
    render(<MissionAutopilotPanel projectId="p-1" taskId="t-1" mission={mission} latestSession={{ id: 's', status: 'succeeded' }} />)

    fireEvent.click(screen.getByRole('button', { name: /Approve plan & build/ }))
    await waitFor(() => expect(approvePlanAndBuild).toHaveBeenCalledWith('p-1', 't-1'))

    fireEvent.click(screen.getByRole('button', { name: /Revise/ }))
    fireEvent.change(screen.getByLabelText('What should change in the plan?'), { target: { value: 'Smaller steps' } })
    fireEvent.click(screen.getByRole('button', { name: /Send revision/ }))
    await waitFor(() => expect(revisePlan).toHaveBeenCalledWith('p-1', 't-1', 'Smaller steps'))
  })

  it('renders nothing while a run is live and nothing needs attention', () => {
    const { container } = render(<MissionAutopilotPanel projectId="p-1" taskId="t-1" mission={{ planGate: { status: 'awaiting_approval' } }} latestSession={{ id: 's', status: 'running' }} />)
    expect(container.innerHTML).toBe('')
  })
})
