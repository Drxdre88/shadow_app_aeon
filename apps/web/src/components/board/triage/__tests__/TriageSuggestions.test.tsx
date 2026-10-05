/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/card-triage', () => ({
  resolveCardTriage: vi.fn(),
  getCardTriageSetting: vi.fn(),
  setCardTriage: vi.fn(),
}))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

import { getCardTriageSetting, resolveCardTriage, setCardTriage } from '@/lib/actions/card-triage'
import { toast } from '@/components/ui/Toast'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { usePinnedCardsStore } from '@/lib/store/pinnedCardsStore'
import type { CardTriage } from '@/lib/kairos/triage/types'
import { TriageSuggestions } from '../TriageSuggestions'
import { CardTriageToggle } from '../CardTriageToggle'
import { triageRows } from '../triage-view'

const triage = (over: Partial<CardTriage> = {}): CardTriage => ({
  v: 1, jobId: 'job-1', at: 'now',
  labels: [{ id: 'lab-bug', reason: 'Looks like a defect', status: 'pending' }],
  priority: { value: 'high', reason: 'Blocks sign-in', status: 'pending' },
  duplicates: [{ taskId: 'old-1', name: 'Old login bug', reason: 'Same symptom', status: 'pending' }],
  ...over,
})

const task = (over: Partial<BoardTask> = {}): BoardTask => ({
  id: 'task-1', projectId: 'p-1', name: 'Login bug', status: 'todo', priority: 'medium', color: 'purple',
  labels: [], onTimeline: false, orderIndex: 0, metadata: { triage: triage() }, ...over,
})

const PRIORITIES = [{ id: 'high', name: 'High', color: '#f00' }, { id: 'medium', name: 'Medium', color: '#ff0' }]

beforeEach(() => {
  vi.clearAllMocks()
  useBoardStore.setState({
    tasks: [task(), task({ id: 'old-1', name: 'Old login bug', status: 'done', metadata: {} })],
    labels: [{ id: 'lab-bug', projectId: 'p-1', name: 'Bug', color: 'red' }],
    isDirty: false,
  })
})

afterEach(() => cleanup())

describe('triageRows', () => {
  const deps = { labels: [{ id: 'lab-bug', name: 'Bug', color: 'red' }], priorities: PRIORITIES, taskNames: new Map([['old-1', 'Old login bug']]) }

  it('shows pending items in plain words', () => {
    expect(triageRows(task(), deps).map((r) => r.title)).toEqual([
      'Add label “Bug”', 'Set priority to High', 'May be the same as “Old login bug”',
    ])
  })

  it('hides stale items: label already on, deleted label, priority already set, dismissed duplicates', () => {
    const t = task({ labels: ['lab-bug'], priority: 'high', metadata: { triage: triage({ duplicates: [{ taskId: 'old-1', name: 'x', reason: 'r', status: 'dismissed' }] }) } })
    expect(triageRows(t, deps)).toEqual([])
    expect(triageRows(task(), { ...deps, labels: [] }).map((r) => r.kind)).toEqual(['priority', 'duplicate'])
    expect(triageRows(task({ metadata: {} }), deps)).toEqual([])
  })

  it('keeps an accepted duplicate as a link', () => {
    const t = task({ metadata: { triage: triage({ labels: [], priority: null, duplicates: [{ taskId: 'old-1', name: 'x', reason: 'r', status: 'accepted' }] }) } })
    expect(triageRows(t, deps)).toMatchObject([{ accepted: true, openable: true, title: 'Marked as the same work as “Old login bug”' }])
  })
})

describe('TriageSuggestions', () => {
  it('renders nothing without suggestions', () => {
    useBoardStore.setState({ tasks: [task({ metadata: {} })] })
    const { container } = render(<TriageSuggestions taskId="task-1" projectId="p-1" />)
    expect(container.innerHTML).toBe('')
  })

  it('accepting a priority saves it, updates the card without marking the board dirty, and syncs the form', async () => {
    const accepted = triage({ priority: { value: 'high', reason: 'Blocks sign-in', status: 'accepted' } })
    vi.mocked(resolveCardTriage).mockResolvedValue({ triage: accepted, applied: true })
    const onPriorityAccepted = vi.fn()
    render(<TriageSuggestions taskId="task-1" projectId="p-1" onPriorityAccepted={onPriorityAccepted} />)
    expect(screen.getByText('Vorath suggests')).toBeTruthy()
    expect(screen.getByText('Blocks sign-in')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[1])
    await waitFor(() => expect(onPriorityAccepted).toHaveBeenCalledWith('high'))
    expect(resolveCardTriage).toHaveBeenCalledWith('p-1', 'task-1', { kind: 'priority', ref: 'high', decision: 'accept' })
    const card = useBoardStore.getState().tasks.find((t) => t.id === 'task-1')!
    expect(card.priority).toBe('high')
    expect(useBoardStore.getState().isDirty).toBe(false)
  })

  it('accepting a label adds it to the card', async () => {
    vi.mocked(resolveCardTriage).mockResolvedValue({ triage: triage({ labels: [{ id: 'lab-bug', reason: 'r', status: 'accepted' }] }), applied: true })
    render(<TriageSuggestions taskId="task-1" projectId="p-1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0])
    await waitFor(() => expect(useBoardStore.getState().tasks[0].labels).toEqual(['lab-bug']))
  })

  it('opens the other card, and a failed save shows the reason', async () => {
    const openCard = vi.fn()
    usePinnedCardsStore.setState({ openCard } as never)
    vi.mocked(resolveCardTriage).mockRejectedValue(new Error('That label no longer exists on this board'))
    render(<TriageSuggestions taskId="task-1" projectId="p-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open the other card' }))
    expect(openCard).toHaveBeenCalledWith('old-1')
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0])
    await waitFor(() => expect(toast).toHaveBeenCalledWith('That label no longer exists on this board'))
  })
})

describe('CardTriageToggle', () => {
  it('is hidden from anyone but the board creator', async () => {
    vi.mocked(getCardTriageSetting).mockResolvedValue({ on: false, canToggle: false })
    const { container } = render(<CardTriageToggle projectId="p-1" isOpen />)
    await waitFor(() => expect(getCardTriageSetting).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('switches on at once and rolls back on failure', async () => {
    vi.mocked(getCardTriageSetting).mockResolvedValue({ on: false, canToggle: true })
    vi.mocked(setCardTriage).mockResolvedValueOnce({ projectId: 'p-1', on: true }).mockRejectedValueOnce(new Error('nope'))
    render(<CardTriageToggle projectId="p-1" isOpen />)
    const button = await screen.findByRole('button', { name: /Vorath sorts new cards/ })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'))
    expect(setCardTriage).toHaveBeenCalledWith('p-1', true)
    fireEvent.click(button)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('nope'))
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})
