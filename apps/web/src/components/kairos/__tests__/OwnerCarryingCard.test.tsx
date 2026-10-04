import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const actions = vi.hoisted(() => ({ getKairosOwnerCard: vi.fn(), correctKairosOwnerItem: vi.fn() }))
vi.mock('@/lib/actions/kairos-owner-model', () => actions)

import { InboxExtras } from '../inbox-extras'
import { OwnerCarryingCard } from '../OwnerCarryingCard'

const ITEMS = [
  { id: 'i1', seq: 1, kind: 'state', candidate: false, text: 'stressed about the launch', firstSeenAt: '2026-09-30T08:00:00.000Z', expiresAt: '2026-10-10T08:00:00.000Z', longRunning: false },
  { id: 'i2', seq: 2, kind: 'trait', candidate: true, text: 'prefers mornings', firstSeenAt: '2026-09-30T08:00:00.000Z', expiresAt: null, longRunning: false },
]

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('inbox extras with KAIROS_OWNER_MODEL off', () => {
  it('renders nothing new and never calls the server', async () => {
    const { container } = render(<InboxExtras ownerModelEnabled={false} />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.getKairosOwnerCard).not.toHaveBeenCalled()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the action fails or nothing is live', async () => {
    actions.getKairosOwnerCard.mockResolvedValue({ enabled: true, items: [] })
    const { container } = render(<OwnerCarryingCard ownerModelEnabled />)
    await waitFor(() => expect(actions.getKairosOwnerCard).toHaveBeenCalledOnce())
    expect(container.innerHTML).toBe('')
  })
})

describe('OwnerCarryingCard', () => {
  it('lists C-numbered items with dates and corrects through the session action', async () => {
    actions.getKairosOwnerCard.mockResolvedValue({ enabled: true, items: ITEMS })
    actions.correctKairosOwnerItem.mockResolvedValue({ ok: true, label: 'C1 over ✓' })
    render(<InboxExtras ownerModelEnabled />)
    expect(await screen.findByText('stressed about the launch')).toBeTruthy()
    expect(screen.getByText('since 30/09, lapses 10/10')).toBeTruthy()
    expect(screen.getByText('right?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '✗ Over' }))
    await waitFor(() => expect(actions.correctKairosOwnerItem).toHaveBeenCalledWith('i1', 'over', undefined))
    expect(await screen.findByText('C1 over ✓')).toBeTruthy()
  })

  it('sends a free-text correction in his words', async () => {
    actions.getKairosOwnerCard.mockResolvedValue({ enabled: true, items: ITEMS.slice(1) })
    actions.correctKairosOwnerItem.mockResolvedValue({ ok: true, label: 'C2 updated in your words ✓' })
    render(<OwnerCarryingCard ownerModelEnabled />)
    fireEvent.click(await screen.findByRole('button', { name: 'Correct…' }))
    fireEvent.change(screen.getByLabelText('Correct C2'), { target: { value: 'only on launch weeks' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(actions.correctKairosOwnerItem).toHaveBeenCalledWith('i2', 'text', 'only on launch weeks'))
  })
})
