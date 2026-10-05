import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const actions = vi.hoisted(() => ({
  confirmMemory: vi.fn(),
  editMemoryInPlace: vi.fn(),
  markMemoryWrong: vi.fn(),
  undoMemoryChange: vi.fn(),
  listNeedsYourEyes: vi.fn(),
  removeNeedsEyesMemory: vi.fn(),
  listWhatVorathKnows: vi.fn(),
}))
vi.mock('@/lib/actions/memory-knows', () => actions)

import { FixPanel, type FixableMemory } from '../FixPanel'
import { NeedsEyesList } from '../NeedsEyesList'
import { useKnowsStore } from '../knowsStore'

const base: FixableMemory = {
  id: 'm1', title: 'Prefers mornings', bodyMd: 'Works best before noon', type: 'note', streamClass: 'idea',
  source: 'claude', sourceMetadata: {}, archivedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useKnowsStore.setState({ version: 0 })
})
afterEach(cleanup)

describe('FixPanel', () => {
  it('edits the words in place and reports the change', async () => {
    const onChanged = vi.fn()
    actions.editMemoryInPlace.mockResolvedValue({})
    render(<FixPanel memory={base} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Prefers evenings' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(actions.editMemoryInPlace).toHaveBeenCalledWith('m1', { title: 'Prefers evenings', bodyMd: 'Works best before noon' })
  })

  it('marks it wrong with a reason and offers Undo once set aside', async () => {
    actions.markMemoryWrong.mockResolvedValue({ ok: true, memoryId: 'm1', opId: 'op-1' })
    const { rerender } = render(<FixPanel memory={base} onChanged={() => {}} />)
    fireEvent.click(screen.getByText('This is wrong'))
    const save = screen.getByText('Set it aside')
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("What's wrong"), { target: { value: 'outdated' } })
    fireEvent.click(save)
    await waitFor(() => expect(actions.markMemoryWrong).toHaveBeenCalledWith('m1', 'outdated'))
    rerender(<FixPanel memory={{ ...base, archivedAt: new Date() }} onChanged={() => {}} />)
    fireEvent.click(await screen.findByText('Undo'))
    await waitFor(() => expect(actions.undoMemoryChange).toHaveBeenCalledWith('op-1'))
  })

  it('offers Confirm only for rows the owner did not write', () => {
    render(<FixPanel memory={base} onChanged={() => {}} />)
    expect(screen.getByText(/s right/)).toBeTruthy()
    cleanup()
    render(<FixPanel memory={{ ...base, source: 'manual' }} onChanged={() => {}} />)
    expect(screen.queryByText(/s right/)).toBeNull()
  })

  it('keeps constitution and goal rows read-only, and beliefs non-editable', () => {
    render(<FixPanel memory={{ ...base, type: 'constitution', streamClass: 'constitution' }} onChanged={() => {}} />)
    expect(screen.getByText(/amendment/)).toBeTruthy()
    expect(screen.queryByText('This is wrong')).toBeNull()
    cleanup()
    render(<FixPanel memory={{ ...base, type: 'inbound', sourceMetadata: { kind: 'goal' } }} onChanged={() => {}} />)
    expect(screen.getByText(/goal flow/)).toBeTruthy()
    cleanup()
    render(<FixPanel memory={{ ...base, type: 'belief', streamClass: 'belief' }} onChanged={() => {}} />)
    expect(screen.queryByText('Edit')).toBeNull()
    expect(screen.getByText('This is wrong')).toBeTruthy()
  })
})

describe('NeedsEyesList', () => {
  const row = (id: string, reason: string, sourceMetadata: Record<string, unknown> = {}) => ({
    id, title: `Row ${id}`, aiTitle: null, summary: null, type: 'reflection', streamClass: 'reflection', source: 'claude',
    sourceMetadata, confidence: null, standing: null, pinned: false, projectId: null, taskId: null,
    createdAt: new Date(), updatedAt: new Date(), dominionId: null, dominionName: null, dominionColor: null, reason,
  })

  it('shows why each row is here and confirms or removes it', async () => {
    actions.listNeedsYourEyes.mockResolvedValueOnce([
      row('a', 'sensitive', { sensitiveHeld: true, sensitiveTopics: ['health'] }),
      row('b', 'low_trust'),
    ]).mockResolvedValue([row('b', 'low_trust')])
    actions.confirmMemory.mockResolvedValue({ ok: true })
    actions.removeNeedsEyesMemory.mockResolvedValue({ ok: true })
    render(<NeedsEyesList onSelect={() => {}} />)
    expect(await screen.findByText(/Held back: it touches health/)).toBeTruthy()
    expect(screen.getByText(/An AI agent working for you wrote this/)).toBeTruthy()

    fireEvent.click(screen.getAllByText('Confirm')[0])
    await waitFor(() => expect(actions.confirmMemory).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.queryByText('Row a')).toBeNull())

    fireEvent.click(screen.getByText('Remove'))
    await waitFor(() => expect(actions.removeNeedsEyesMemory).toHaveBeenCalledWith('b'))
  })

  it('says so when nothing needs a look', async () => {
    actions.listNeedsYourEyes.mockResolvedValue([])
    render(<NeedsEyesList onSelect={() => {}} />)
    expect(await screen.findByText('Nothing needs your eyes right now.')).toBeTruthy()
  })
})
