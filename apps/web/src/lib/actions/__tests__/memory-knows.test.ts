import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ findMemoryById: vi.fn(), updateMemory: vi.fn() }))
vi.mock('@/lib/data/memory-knows', () => ({
  confirmMemoryAsOwner: vi.fn(),
  getMemoryProvenance: vi.fn(),
  listKnownRows: vi.fn(),
  listNeedsEyes: vi.fn(),
  rejectMemoryAsWrong: vi.fn(),
}))
vi.mock('@/lib/kairos/engine/revert', () => ({ revertMemoryOp: vi.fn() }))
vi.mock('@/lib/data/kairos-sensitive', () => ({ getSensitiveGate: vi.fn(), setSensitiveGate: vi.fn() }))
vi.mock('@/lib/kairos/constitution/amendment', () => ({
  isConstitutionRow: (r: { type?: string; streamClass?: string } | null) => r?.type === 'constitution' || r?.streamClass === 'constitution',
}))

import { requireAuth } from '@/lib/actions/helpers'
import { findMemoryById, updateMemory } from '@/lib/data/memories'
import { confirmMemoryAsOwner, rejectMemoryAsWrong } from '@/lib/data/memory-knows'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'
import { setSensitiveGate } from '@/lib/data/kairos-sensitive'
import {
  confirmMemory,
  editMemoryInPlace,
  markMemoryWrong,
  removeNeedsEyesMemory,
  setSensitiveGateSetting,
  undoMemoryChange,
} from '../memory-knows'

const USER = 'user-1'
const ID = '11111111-1111-4111-8111-111111111111'
const OP = '22222222-2222-4222-8222-222222222222'
const note = { id: ID, type: 'note', streamClass: 'idea', title: 'Old', bodyMd: 'old', sourceMetadata: {} }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(USER)
  vi.mocked(findMemoryById).mockResolvedValue(note as never)
})

describe('editMemoryInPlace', () => {
  it('writes through updateMemory with the operator origin', async () => {
    vi.mocked(updateMemory).mockResolvedValue({ ...note, title: 'New' } as never)
    await editMemoryInPlace(ID, { title: ' New ', bodyMd: 'fixed text' })
    expect(updateMemory).toHaveBeenCalledWith(ID, USER, { title: 'New', bodyMd: 'fixed text' }, { origin: { kind: 'operator', via: 'ui-fix' } })
  })

  it('refuses constitution, goal and belief rows', async () => {
    for (const row of [
      { ...note, type: 'constitution', streamClass: 'constitution' },
      { ...note, type: 'inbound', sourceMetadata: { kind: 'goal' } },
      { ...note, type: 'belief', streamClass: 'belief' },
    ]) {
      vi.mocked(findMemoryById).mockResolvedValueOnce(row as never)
      await expect(editMemoryInPlace(ID, { title: 'x', bodyMd: 'y' })).rejects.toThrow()
    }
    expect(updateMemory).not.toHaveBeenCalled()
  })

  it('rejects a memory the caller does not own', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce(null as never)
    await expect(editMemoryInPlace(ID, { title: 'x', bodyMd: 'y' })).rejects.toThrow('Memory not found')
    expect(findMemoryById).toHaveBeenCalledWith(ID, USER)
  })

  it('rejects empty text', async () => {
    await expect(editMemoryInPlace(ID, { title: '  ', bodyMd: 'y' })).rejects.toThrow()
    expect(updateMemory).not.toHaveBeenCalled()
  })
})

describe('markMemoryWrong / remove', () => {
  it('archives with the owner reason and returns the undo op', async () => {
    vi.mocked(rejectMemoryAsWrong).mockResolvedValue({ ok: true, memoryId: ID, opId: OP })
    await expect(markMemoryWrong(ID, ' not true anymore ')).resolves.toEqual({ ok: true, memoryId: ID, opId: OP })
    expect(rejectMemoryAsWrong).toHaveBeenCalledWith(USER, ID, 'not true anymore')
  })

  it('needs a reason', async () => {
    await expect(markMemoryWrong(ID, '   ')).rejects.toThrow()
    expect(rejectMemoryAsWrong).not.toHaveBeenCalled()
  })

  it('refuses constitution rows', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce({ ...note, type: 'constitution' } as never)
    await expect(markMemoryWrong(ID, 'no')).rejects.toThrow(/amendment/)
    expect(rejectMemoryAsWrong).not.toHaveBeenCalled()
  })

  it('Remove from Needs your eyes is a reversible set-aside', async () => {
    vi.mocked(rejectMemoryAsWrong).mockResolvedValue({ ok: true, memoryId: ID, opId: OP })
    await removeNeedsEyesMemory(ID)
    expect(rejectMemoryAsWrong).toHaveBeenCalledWith(USER, ID, 'Removed from Needs your eyes')
  })
})

describe('confirmMemory', () => {
  it('confirms an owned row', async () => {
    vi.mocked(confirmMemoryAsOwner).mockResolvedValue({ ok: true, memoryId: ID, opId: null })
    await confirmMemory(ID)
    expect(confirmMemoryAsOwner).toHaveBeenCalledWith(USER, ID)
  })

  it('refuses goal rows', async () => {
    vi.mocked(findMemoryById).mockResolvedValueOnce({ ...note, type: 'inbound', sourceMetadata: { kind: 'goal' } } as never)
    await expect(confirmMemory(ID)).rejects.toThrow(/goal/i)
    expect(confirmMemoryAsOwner).not.toHaveBeenCalled()
  })
})

describe('undoMemoryChange', () => {
  it('reverts through the existing op ledger', async () => {
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: true, opId: OP, revertOpId: ID, restoredMemoryIds: [ID] })
    await undoMemoryChange(OP)
    expect(revertMemoryOp).toHaveBeenCalledWith(USER, OP, expect.objectContaining({ reason: expect.any(String) }))
  })

  it('explains a stale undo in plain words', async () => {
    vi.mocked(revertMemoryOp).mockResolvedValue({ ok: false, reason: 'stale' })
    await expect(undoMemoryChange(OP)).rejects.toThrow(/changed since then/)
  })
})

describe('setSensitiveGateSetting', () => {
  it('requires auth and a boolean', async () => {
    vi.mocked(setSensitiveGate).mockResolvedValue(true)
    await setSensitiveGateSetting(true)
    expect(setSensitiveGate).toHaveBeenCalledWith(USER, true)
    await expect(setSensitiveGateSetting('yes' as unknown as boolean)).rejects.toThrow()
  })
})
