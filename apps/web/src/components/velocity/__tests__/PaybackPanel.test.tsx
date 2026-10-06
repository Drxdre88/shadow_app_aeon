/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/lib/actions/payback', () => ({ getAgentPayback: vi.fn() }))

import { PaybackPanel } from '../PaybackPanel'
import { getAgentPayback } from '@/lib/actions/payback'
import type { PaybackBucket, PaybackView } from '@/lib/data/payback'

const PROJECT = '11111111-1111-4111-8111-111111111111'

const tally = { missions: 42, succeeded: 31, failed: 6, runnerDied: 5, running: 0, queued: 0, costKnownUsd: 12.4, missionsWithUnknownCost: 17, totalDurationMin: 300, costPerSucceeded: 0.8 }
const bucket = (key: string): PaybackBucket => ({ key, ...tally })

function view(over: Partial<PaybackView['totals']> = {}): PaybackView {
  return {
    period: '30d',
    since: null,
    projectId: PROJECT,
    totals: { ...tally, ...over },
    breakdowns: { engine: [bucket('claude')], model: [bucket('default')] },
    topCards: [{ taskId: 't1', cardName: 'Ship the ledger', boardName: 'Aeon', missions: 2, costKnownUsd: 4.2 }],
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const statValue = (label: string) => screen.getByText(label).previousElementSibling?.textContent

describe('PaybackPanel', () => {
  it('shows the headline numbers, breakdowns and top cards', async () => {
    vi.mocked(getAgentPayback).mockResolvedValue(view())
    render(<PaybackPanel projectId={PROJECT} range="30d" />)
    expect(await screen.findByText('Known cost')).toBeTruthy()
    expect(getAgentPayback).toHaveBeenCalledWith({ projectId: PROJECT, period: '30d' })
    const expected: Array<[string, string]> = [
      ['Missions', '42'], ['Finished', '31'], ['Failed', '6'], ['Runner died', '5'],
      ['Known cost', '$12.40'], ['No cost recorded', '17'], ['Per finished mission', '$0.80'],
    ]
    for (const [label, value] of expected) expect(statValue(label)).toBe(value)
    expect(screen.getByText('claude')).toBeTruthy()
    expect(screen.getByText('default')).toBeTruthy()
    expect(screen.getByText('Ship the ledger')).toBeTruthy()
  })

  it("shows 'Unknown' per finished mission when no cost is known", async () => {
    vi.mocked(getAgentPayback).mockResolvedValue(view({ costPerSucceeded: null, costKnownUsd: 0 }))
    render(<PaybackPanel projectId={PROJECT} range="7d" />)
    await screen.findByText('Per finished mission')
    expect(statValue('Per finished mission')).toBe('Unknown')
  })

  it('shows the empty state when the board had no missions', async () => {
    vi.mocked(getAgentPayback).mockResolvedValue(view({ missions: 0, succeeded: 0, failed: 0, runnerDied: 0 }))
    render(<PaybackPanel projectId={PROJECT} range="7d" />)
    expect(await screen.findByText('No Hangar missions on this board in this period.')).toBeTruthy()
  })
})
