/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MissionCardFace } from '../MissionCardFace'

afterEach(cleanup)

describe('MissionCardFace', () => {
  it('does not add a mission surface to a normal PM card', () => {
    const { container } = render(<MissionCardFace metadata={{ note: 'ordinary card' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows execution context as dedicated fields', () => {
    render(<MissionCardFace metadata={{ hangar: {
      repo: 'aeon',
      objective: 'recon',
      agent: 'copilot',
      model: 'gpt-5.6-sol',
      instruction: 'Inspect the mission card experience',
      autoRun: true,
    } }} />)

    expect(screen.getByLabelText('Agent mission summary')).toBeTruthy()
    expect(screen.getByText('Repo')).toBeTruthy()
    expect(screen.getByText('aeon')).toBeTruthy()
    expect(screen.getByText('Objective')).toBeTruthy()
    expect(screen.getByText('recon')).toBeTruthy()
    expect(screen.getByLabelText('Auto-run armed')).toBeTruthy()
  })

  it('labels cached output as recorded and surfaces needs-input without claiming live status', () => {
    render(<MissionCardFace metadata={{ hangar: {
      repo: 'aeon',
      objective: 'analysis',
      agent: 'copilot',
      instruction: 'Compare both approaches',
      lastResult: { status: 'needs_input', summary: 'Waiting for a decision', questions: ['Pick A or B?'] },
    } }} />)

    expect(screen.getByText(/Last recorded result · needs input/)).toBeTruthy()
    expect(screen.queryByText(/running/i)).toBeNull()
  })
})
