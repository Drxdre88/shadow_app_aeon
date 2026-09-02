/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

// The Gantt "Reset" button blanks the dates of every on-timeline card in the
// project. On a live board that is dozens of cards gone to one misclick, so
// the destructive button stays disarmed until the user types RESET.

import { GanttResetModal, countTimelineResetImpact, isResetConfirmation } from '../GanttResetModal'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'

const task = (id: string, extra: Partial<BoardTask> = {}): BoardTask => ({
  id,
  projectId: 'p1',
  name: id,
  status: 'todo',
  priority: 'medium',
  color: 'purple',
  labels: [],
  onTimeline: false,
  orderIndex: 0,
  ...extra,
})

const seedTasks = () => useBoardStore.setState({
  tasks: [
    task('a', { onTimeline: true, startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-03T00:00:00.000Z' }),
    task('b', { onTimeline: true, startDate: '2026-09-04T00:00:00.000Z' }),
    task('c', { onTimeline: false, ganttTaskId: 'bar-c' }),
    task('d', { onTimeline: false, startDate: '2026-09-10T00:00:00.000Z' }),
  ],
})

beforeEach(() => {
  useThemeStore.setState({ smoothUiRenders: false })
  seedTasks()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const confirmButton = () => screen.getByRole('button', { name: /reset timeline|resetting/i })
const input = () => screen.getByLabelText(/type/i) as HTMLInputElement

function openModal(props: Partial<React.ComponentProps<typeof GanttResetModal>> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(<GanttResetModal isOpen onConfirm={onConfirm} onClose={onClose} {...props} />)
  return { onConfirm, onClose }
}

describe('countTimelineResetImpact', () => {
  it('matches the server scope: either half of the timeline link qualifies', () => {
    expect(countTimelineResetImpact(useBoardStore.getState().tasks)).toEqual({ affected: 3, dated: 2 })
  })

  it('leaves hand-dated cards that were never on the timeline out of the count', () => {
    useBoardStore.setState({ tasks: [task('d', { startDate: '2026-09-10T00:00:00.000Z' })] })
    expect(countTimelineResetImpact(useBoardStore.getState().tasks)).toEqual({ affected: 0, dated: 0 })
  })
})

describe('isResetConfirmation', () => {
  it.each(['RESET', 'reset', ' Reset ', '\treset\n'])('accepts %j', (v) => {
    expect(isResetConfirmation(v)).toBe(true)
  })

  it.each(['', 'RESE', 'RESETT', 'RE SET', 'yes'])('rejects %j', (v) => {
    expect(isResetConfirmation(v)).toBe(false)
  })
})

describe('GanttResetModal', () => {
  it('renders nothing when closed', () => {
    render(<GanttResetModal isOpen={false} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows how many cards come off the timeline and how many lose dates', () => {
    openModal()
    expect(screen.getByTestId('reset-affected-count').textContent).toBe('3')
    expect(screen.getByText(/2 of them have start or end dates/i)).toBeTruthy()
  })

  it('keeps the destructive button disabled until RESET is typed', () => {
    const { onConfirm } = openModal()
    expect(confirmButton()).toHaveProperty('disabled', true)

    fireEvent.change(input(), { target: { value: 'rese' } })
    expect(confirmButton()).toHaveProperty('disabled', true)
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { value: '  reset ' } })
    expect(confirmButton()).toHaveProperty('disabled', false)
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('Enter confirms only once armed', () => {
    const { onConfirm } = openModal()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(input(), { target: { value: 'RESET' } })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancel button, Escape and backdrop close without confirming', () => {
    const { onConfirm, onClose } = openModal()
    fireEvent.change(input(), { target: { value: 'RESET' } })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('dialog').parentElement!)

    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('locks every exit and the input while the reset is running', () => {
    const { onConfirm, onClose } = openModal({ isLoading: true })
    expect(screen.getByText(/resetting/i)).toBeTruthy()
    expect(input()).toHaveProperty('disabled', true)
    expect(confirmButton()).toHaveProperty('disabled', true)

    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('explains an empty timeline instead of showing a zero count', () => {
    useBoardStore.setState({ tasks: [task('d', { startDate: '2026-09-10T00:00:00.000Z' })] })
    openModal()
    expect(screen.queryByTestId('reset-affected-count')).toBeNull()
    expect(screen.getByText(/no cards are on the timeline/i)).toBeTruthy()
  })

  it('disarms again when a reset fails and the dialog stays open', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { rerender } = render(<GanttResetModal isOpen onConfirm={onConfirm} onClose={onClose} />)
    fireEvent.change(input(), { target: { value: 'RESET' } })
    expect(confirmButton()).toHaveProperty('disabled', false)

    rerender(<GanttResetModal isOpen isLoading onConfirm={onConfirm} onClose={onClose} />)
    rerender(<GanttResetModal isOpen isLoading={false} onConfirm={onConfirm} onClose={onClose} />)

    expect(input().value).toBe('')
    expect(confirmButton()).toHaveProperty('disabled', true)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('cycles Tab and Shift+Tab inside the dialog', () => {
    openModal()
    const close = screen.getByRole('button', { name: 'Close' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })

    cancel.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)

    input().focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(input())

    input().blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
  })

  it('the armed reset button joins the cycle as the last stop', () => {
    openModal()
    fireEvent.change(input(), { target: { value: 'RESET' } })
    confirmButton().focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('returns focus to the button that opened it once it has animated out', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'Reset'
    document.body.appendChild(opener)
    opener.focus()

    const { rerender } = render(<GanttResetModal isOpen onConfirm={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(document.activeElement).toBe(input()))

    rerender(<GanttResetModal isOpen={false} onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})
