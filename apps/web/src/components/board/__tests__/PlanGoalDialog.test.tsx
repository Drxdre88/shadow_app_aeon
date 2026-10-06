/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const requestCardTreeAction = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/card-tree', () => ({ requestCardTreeAction }))

import { PlanGoalDialog } from '../PlanGoalDialog'

afterEach(cleanup)

describe('PlanGoalDialog', () => {
  it('sends the goal to Vorath and shows that nothing is created until approval', async () => {
    requestCardTreeAction.mockResolvedValue({ ok: true, jobId: 'job-1', status: 'queued', alreadyRequested: false, message: 'Vorath will draft it on his next run; you approve before anything is created.' })
    render(<PlanGoalDialog projectId="p-1" />)
    fireEvent.click(screen.getByRole('button', { name: /plan a goal/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /plan a goal/i }))
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: 'Launch it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Vorath' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('editor access'))
  })
})
