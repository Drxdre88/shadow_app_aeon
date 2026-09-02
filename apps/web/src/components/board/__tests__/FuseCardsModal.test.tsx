/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FuseCardsModal, isValidFusedName, MAX_FUSED_NAME } from '../FuseCardsModal'
import { useBoardStore, type BoardTask } from '@/lib/store/boardStore'
import { useThemeStore } from '@/stores/themeStore'

// The fusion confirm dialog: the survivor's title is the starting point, an
// empty title disarms the button, confirming hands the trimmed title back.

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

const source = task('Absorbed card', { priority: 'urgent', labels: ['l1', 'l2'], description: 'notes' })
const target = task('Surviving card', { priority: 'low', labels: ['l2'] })

beforeEach(() => {
  useThemeStore.setState({ smoothUiRenders: false })
  useBoardStore.setState({ checklistSummaries: { [source.id]: { checked: 1, crossed: 0, total: 3 } } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const input = () => screen.getByLabelText(/new title/i) as HTMLInputElement
const confirmButton = () => screen.getByRole('button', { name: /fuse cards|fusing/i })

function open(props: Partial<React.ComponentProps<typeof FuseCardsModal>> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(<FuseCardsModal isOpen source={source} target={target} onConfirm={onConfirm} onClose={onClose} {...props} />)
  return { onConfirm, onClose }
}

describe('isValidFusedName', () => {
  it('needs a non-blank title within the schema length', () => {
    expect(isValidFusedName('  ')).toBe(false)
    expect(isValidFusedName('ok')).toBe(true)
    expect(isValidFusedName('x'.repeat(MAX_FUSED_NAME))).toBe(true)
    expect(isValidFusedName('x'.repeat(MAX_FUSED_NAME + 1))).toBe(false)
  })
})

describe('FuseCardsModal', () => {
  it('prefills the survivor\'s title and shows both cards plus a merge summary', () => {
    open()
    expect(input().value).toBe('Surviving card')
    expect(screen.getByText('Absorbed card')).toBeTruthy()
    expect(screen.getByText('Surviving card')).toBeTruthy()
    const summary = screen.getByTestId('fuse-summary').textContent ?? ''
    expect(summary).toContain('2 labels')
    expect(summary).toContain('3 checklist items')
    expect(summary).toContain('urgent')
    expect(summary).toContain('description is appended')
  })

  it('disarms the confirm button on an empty title', () => {
    const { onConfirm } = open()
    fireEvent.change(input(), { target: { value: '   ' } })
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms with the trimmed title, by click and by Enter', () => {
    const { onConfirm } = open()
    fireEvent.change(input(), { target: { value: '  Fused title  ' } })
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith('Fused title')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  it('Escape and the backdrop cancel; neither works while loading', () => {
    const { onClose } = open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    cleanup()

    const loading = open({ isLoading: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(loading.onClose).not.toHaveBeenCalled()
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true)
    expect(confirmButton().textContent).toMatch(/fusing/i)
  })

  it('renders nothing without both cards', () => {
    const { container } = render(<FuseCardsModal isOpen source={source} target={null} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
