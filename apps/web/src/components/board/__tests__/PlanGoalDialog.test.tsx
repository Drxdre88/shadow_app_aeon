/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const { requestCardTreeAction, getCardTreeAvailabilityAction } = vi.hoisted(() => ({ requestCardTreeAction: vi.fn(), getCardTreeAvailabilityAction: vi.fn() }))
vi.mock('@/lib/actions/card-tree', () => ({ requestCardTreeAction, getCardTreeAvailabilityAction }))

import { PlanGoalDialog } from '../PlanGoalDialog'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  getCardTreeAvailabilityAction.mockResolvedValue({ available: true })
})

describe('PlanGoalDialog', () => {
  it('sends the goal to Vorath and shows that nothing is created until approval', async () => {
    requestCardTreeAction.mockResolvedValue({ ok: true, jobId: 'job-1', status: 'queued', alreadyRequested: false, message: 'Vorath will draft it on his next run; you approve before anything is created.' })
    render(<PlanGoalDialog projectId="p-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /plan a goal/i }))
    const send = screen.getByRole('button', { name: 'Send to Vorath' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Launch the beta page' } })
    fireEvent.click(send)
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('you approve before anything is created'))
    expect(requestCardTreeAction).toHaveBeenCalledWith('p-1', 'Launch the beta page')
  })

  it('shows a refusal in plain words', async () => {
    requestCardTreeAction.mockResolvedValue({ ok: false, reason: 'forbidden', message: 'You need editor access to this board to plan a goal on it' })
    render(<PlanGoalDialog projectId="p-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /plan a goal/i }))
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Launch it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Vorath' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('editor access'))
  })

  it('hides the entry when the brain routine is not connected for this user', async () => {
    getCardTreeAvailabilityAction.mockResolvedValue({ available: false, reason: 'no_brain', message: 'not connected' })
    render(<PlanGoalDialog projectId="p-1" />)
    await waitFor(() => expect(getCardTreeAvailabilityAction).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByRole('button', { name: /plan a goal/i })).toBeNull()
  })

  it('shows the no-brain refusal in plain words if it races the check', async () => {
    requestCardTreeAction.mockResolvedValue({ ok: false, reason: 'no_brain', message: "Vorath can't draft plans for you yet — his thinking routine isn't connected for your account" })
    render(<PlanGoalDialog projectId="p-1" />)
    fireEvent.click(await screen.findByRole('button', { name: /plan a goal/i }))
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Launch it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Vorath' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain("thinking routine isn't connected"))
  })
})
