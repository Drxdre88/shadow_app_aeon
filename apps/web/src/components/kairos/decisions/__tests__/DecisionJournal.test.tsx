import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { KairosDecisionView, KairosDecisionsList } from '@/lib/kairos/decisions/types'

const actions = vi.hoisted(() => ({
  logOwnKairosDecision: vi.fn(),
  settleOwnKairosDecision: vi.fn(),
  confirmOwnKairosDecision: vi.fn(),
  discardOwnKairosDecision: vi.fn(),
  listOwnKairosDecisions: vi.fn(),
}))
vi.mock('@/lib/actions/kairos-decisions', () => actions)
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

import { DecisionJournal } from '../DecisionJournal'

function view(over: Partial<KairosDecisionView>): KairosDecisionView {
  return {
    id: '00000000-0000-4000-8000-000000000001', number: 'D1', seq: 1, decision: 'Hire a designer', expectation: 'new site live',
    probability: 0.8, decisionType: 'hire', typeLabel: 'Hiring calls', checkBy: '2026-10-07', due: true, status: 'open',
    relayed: false, needsConfirm: false, createdAt: '2026-10-01T09:00:00.000Z', settledAt: null, ...over,
  }
}

const LIST: KairosDecisionsList = {
  decisions: [
    view({}),
    view({ id: '00000000-0000-4000-8000-000000000002', number: 'D2', seq: 2, decision: 'Back Hydra', relayed: true, needsConfirm: true, due: false, checkBy: '2026-12-01' }),
  ],
  calibration: {
    minPerType: 3,
    settled: 5,
    byType: [{ decisionType: 'hire', label: 'Hiring calls', n: 5, right: 4, hitRate: 0.8, brier: 0.16, overconfidence: 0, meanProbability: 0.8 }],
    building: [],
  },
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('DecisionJournal', () => {
  it('shows open decisions due first, the relayed prompt and calibration in plain words', () => {
    render(<DecisionJournal initial={LIST} />)
    expect(screen.getByText('Hire a designer')).toBeTruthy()
    expect(screen.getByText('due 2026-10-07')).toBeTruthy()
    expect(screen.getByText('relayed, confirm?')).toBeTruthy()
    expect(screen.getByText('Hiring calls: 4 of 5 right when you were 80% sure — about as sure as you should be')).toBeTruthy()
    expect(screen.getByText(/not for trades/i)).toBeTruthy()
  })

  it('settles and confirms through the owner session actions', async () => {
    const settled = { ...LIST, decisions: [LIST.decisions[1]!] }
    actions.settleOwnKairosDecision.mockResolvedValue({ ok: true, list: settled })
    actions.confirmOwnKairosDecision.mockResolvedValue({ ok: true, list: settled })
    render(<DecisionJournal initial={LIST} />)

    fireEvent.click(screen.getByRole('button', { name: '✓ Right' }))
    await waitFor(() => expect(actions.settleOwnKairosDecision).toHaveBeenCalledWith(LIST.decisions[0]!.id, 'right'))
    await waitFor(() => expect(screen.queryByText('Hire a designer')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '✓ Mine, confirm' }))
    await waitFor(() => expect(actions.confirmOwnKairosDecision).toHaveBeenCalledWith(LIST.decisions[1]!.id))
  })

  it('logs a decision from the short form and shows a refusal', async () => {
    actions.logOwnKairosDecision.mockResolvedValue({ ok: false, error: 'Pick a check-by date from today on.' })
    render(<DecisionJournal initial={{ ...LIST, decisions: [] }} />)

    fireEvent.change(screen.getByPlaceholderText(/Back Hydra over Visor/), { target: { value: 'Pause the Visor pilot' } })
    fireEvent.change(screen.getByPlaceholderText(/paying users/), { target: { value: 'More time for Hydra' } })
    fireEvent.change(screen.getByLabelText('Decision type'), { target: { value: 'priority' } })
    fireEvent.change(screen.getByLabelText('Check by'), { target: { value: '2026-11-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log decision' }))

    await waitFor(() => expect(actions.logOwnKairosDecision).toHaveBeenCalledWith({
      decision: 'Pause the Visor pilot', expectation: 'More time for Hydra', probability: 0.7, decisionType: 'priority', checkBy: '2026-11-15',
    }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
