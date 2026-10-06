/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CardTreeProposal, cardTreeDecisionText } from '../CardTreeProposal'

afterEach(cleanup)

const tree = {
  projectId: 'p-1',
  projectName: 'Beta',
  goal: 'Ship sign-up',
  rationale: 'Form first, then the API.',
  expiresAt: '2026-10-13T12:00:00.000Z',
  cards: [
    { key: 'A', name: 'Design form', description: 'Fields and copy', priority: 'high' as const, labels: ['Frontend'], checklist: ['Sketch', 'Review'], dependsOn: [] },
    { key: 'B', name: 'Wire API', description: '', priority: 'medium' as const, labels: [], checklist: [], dependsOn: ['A'] },
  ],
}

describe('CardTreeProposal', () => {
  it('shows the goal, every card and what it waits on, with Approve and Veto', () => {
    const onDecide = vi.fn()
    render(<ul><CardTreeProposal proposal={{ id: 'm-1', title: 'Card tree proposal: Beta' }} cardTree={tree} working={false} decision={undefined} onDecide={onDecide} /></ul>)
    expect(screen.getByText('Ship sign-up')).toBeTruthy()
    expect(screen.getByText('Design form')).toBeTruthy()
    expect(screen.getByText('Labels: Frontend · 2 checklist steps')).toBeTruthy()
    expect(screen.getByText('After: Design form')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    fireEvent.click(screen.getByRole('button', { name: 'Veto' }))
    expect(onDecide.mock.calls).toEqual([['m-1', 'approve'], ['m-1', 'veto']])
  })

  it('replaces the buttons with the outcome once decided', () => {
    render(<ul><CardTreeProposal proposal={{ id: 'm-1', title: 'T' }} cardTree={tree} working={false} decision={{ ok: true, verdict: 'approve' }} onDecide={vi.fn()} /></ul>)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Approved — cards created ✓')
    expect(cardTreeDecisionText({ ok: false, reason: 'forbidden_actor' })).toContain('no longer edit')
  })
})
