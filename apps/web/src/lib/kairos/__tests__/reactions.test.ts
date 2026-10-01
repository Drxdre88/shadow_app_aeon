import { beforeEach, describe, expect, it, vi } from 'vitest'

// Operator reactions orchestration (docs/kairos/32 §2, docs/kairos/34 §6):
// write the reaction (+ its feedback op) through the data layer, then rescore
// exactly the touched rows — only after the write committed. Best-effort:
// a failing write or rescore is logged and never fails the caller.

vi.mock('@/lib/data/memory-reactions', () => ({
  writeOutcomeReaction: vi.fn(),
  writeUseReaction: vi.fn(),
}))

vi.mock('../rescore', () => ({
  rescoreMemories: vi.fn(async () => ({ scored: 0, opsWritten: 0 })),
}))

import { writeOutcomeReaction, writeUseReaction } from '@/lib/data/memory-reactions'
import { rescoreMemories } from '../rescore'
import { reactOutcome, reactUsed } from '../reactions'

const USER = 'user-1'
const MEM = 'a1111111-1111-4111-8111-111111111111'
const MEM2 = 'a2222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('reactOutcome', () => {
  it('writes the outcome, then rescores the target after the write resolved', async () => {
    vi.mocked(writeOutcomeReaction).mockResolvedValue(true)

    await reactOutcome(USER, MEM, 'positive', 'accepted')

    expect(writeOutcomeReaction).toHaveBeenCalledWith(USER, MEM, 'positive', 'accepted')
    expect(rescoreMemories).toHaveBeenCalledWith(USER, [MEM], 'accepted')
    expect(vi.mocked(rescoreMemories).mock.invocationCallOrder[0])
      .toBeGreaterThan(vi.mocked(writeOutcomeReaction).mock.invocationCallOrder[0])
  })

  it('skips the rescore when nothing was touched', async () => {
    vi.mocked(writeOutcomeReaction).mockResolvedValue(false)
    await reactOutcome(USER, 'nope', 'negative', 'dismissed')
    expect(rescoreMemories).not.toHaveBeenCalled()
  })

  it('swallows a failed write (rolled back) and does not rescore', async () => {
    vi.mocked(writeOutcomeReaction).mockRejectedValue(new Error('column "use_count" does not exist'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reactOutcome(USER, MEM, 'positive', 'accepted')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(rescoreMemories).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never fails the caller when the rescore throws', async () => {
    vi.mocked(writeOutcomeReaction).mockResolvedValue(true)
    vi.mocked(rescoreMemories).mockRejectedValueOnce(new Error('boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reactOutcome(USER, MEM, 'positive', 'accepted')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('reactUsed', () => {
  it('rescores exactly the memories the write touched', async () => {
    vi.mocked(writeUseReaction).mockResolvedValue([MEM, MEM2])
    const at = new Date('2026-09-30T12:00:00Z')

    await reactUsed(USER, [MEM, MEM2, 'thought-7'], 'cited', at)

    expect(writeUseReaction).toHaveBeenCalledWith(USER, [MEM, MEM2, 'thought-7'], 'cited', at)
    expect(rescoreMemories).toHaveBeenCalledWith(USER, [MEM, MEM2], 'cited')
  })

  it('skips the rescore when nothing was touched', async () => {
    vi.mocked(writeUseReaction).mockResolvedValue([])
    await reactUsed(USER, ['thought-7'], 'cited')
    expect(rescoreMemories).not.toHaveBeenCalled()
  })

  it('swallows a failed write instead of failing the caller', async () => {
    vi.mocked(writeUseReaction).mockRejectedValue(new Error('memory_ops insert failed'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(reactUsed(USER, [MEM], 'cited')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(rescoreMemories).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
