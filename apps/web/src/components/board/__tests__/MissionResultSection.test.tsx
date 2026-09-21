/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MissionResultSection } from '../MissionResultSection'

afterEach(cleanup)

describe('MissionResultSection', () => {
  it('makes questions prominent and renders delivery evidence as text', () => {
    render(<MissionResultSection result={{
      status: 'needs_input',
      outcome: 'blocked',
      summary: 'The implementation needs an owner decision.',
      branch: 'agent/mission-card',
      commit: 'abc1234',
      artifacts: ['docs/report.md', 'javascript:alert(1)'],
      tests: { status: 'not_run', summary: 'Waiting on direction' },
      questions: ['Should this replace the PM card editor?'],
      recommended_tasks: [{ title: 'Polish mobile layout', objective: 'implement', instruction: 'Check 390px width.' }],
    }} />)

    expect(screen.getByText('Input required')).toBeTruthy()
    expect(screen.getByText('Should this replace the PM card editor?')).toBeTruthy()
    expect(screen.getByText('agent/mission-card')).toBeTruthy()
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Polish mobile layout')).toBeTruthy()
  })

  it('handles a malformed legacy envelope without throwing or claiming completion', () => {
    render(<MissionResultSection result={{ status: 'success', summary: 42, questions: 'none' }} />)
    expect(screen.getByText('Unrecognized result')).toBeTruthy()
    expect(screen.getByText('The recorded result has no readable details.')).toBeTruthy()
    expect(screen.queryByText('Completed')).toBeNull()
  })
})
