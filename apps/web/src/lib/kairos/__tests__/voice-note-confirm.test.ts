import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/voice-notes', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/data/voice-notes')>()
  return { isConfirmableSegment: real.isConfirmableSegment, listVoiceNoteSegments: vi.fn() }
})
vi.mock('../proposal-accept', () => ({ acceptKairosProposal: vi.fn() }))
vi.mock('../today', () => ({ recordToday: vi.fn(async () => undefined) }))
vi.mock('@/lib/db', () => ({ db: {} }))

import { listVoiceNoteSegments } from '@/lib/data/voice-notes'
import { acceptKairosProposal } from '../proposal-accept'
import { recordToday } from '../today'
import { confirmVoiceNote } from '../voice-note-confirm'

const seg = (id: string, part: number, type = 'inbound', status: string | null = 'pending', archivedAt: Date | null = null) =>
  ({ id, type, status, archivedAt, voiceNote: { noteId: 'N', part, of: 4 } })

beforeEach(() => vi.clearAllMocks())

describe('confirmVoiceNote', () => {
  it('accepts every still-open segment through the inbox accept path as the operator', async () => {
    vi.mocked(listVoiceNoteSegments).mockResolvedValue([
      seg('a', 1),
      seg('b', 2, 'reflection', 'accepted'),
      seg('c', 3, 'inbound', 'pending', new Date()),
      seg('d', 4, 'inbound', 'promoted'),
    ])
    vi.mocked(acceptKairosProposal).mockResolvedValue({ ok: true, memory: {} as never })

    expect(await confirmVoiceNote('u1', 'N')).toEqual({ noteId: 'N', parts: 4, accepted: 2 })
    expect(vi.mocked(acceptKairosProposal).mock.calls).toEqual([
      ['a', 'u1', { pin: false }, { origin: { kind: 'operator', via: 'accept' }, recordToday: false }],
      ['d', 'u1', { pin: false }, { origin: { kind: 'operator', via: 'accept' }, recordToday: false }],
    ])
  })

  it('logs ONE aggregate voice_confirmed entry for the whole note, not one per segment', async () => {
    vi.mocked(listVoiceNoteSegments).mockResolvedValue([seg('a', 1), seg('b', 2), seg('c', 3), seg('d', 4)])
    vi.mocked(acceptKairosProposal).mockResolvedValue({ ok: true, memory: {} as never })

    await confirmVoiceNote('u1', 'N')

    expect(acceptKairosProposal).toHaveBeenCalledTimes(4)
    expect(recordToday).toHaveBeenCalledOnce()
    expect(recordToday).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ key: 'voice:N:confirmed', channel: 'voice', type: 'voice_confirmed', covered: 'voice-accept' }),
      { kind: 'operator', via: 'accept' },
    )
    expect(vi.mocked(recordToday).mock.calls[0][1].text).toContain('4 of 4 parts')
  })

  it('logs nothing when no segment was accepted', async () => {
    vi.mocked(listVoiceNoteSegments).mockResolvedValue([seg('a', 1)])
    vi.mocked(acceptKairosProposal).mockResolvedValue({ ok: false, reason: 'not_a_proposal' })

    await confirmVoiceNote('u1', 'N')

    expect(recordToday).not.toHaveBeenCalled()
  })

  it('counts only successful accepts and returns null for an unknown note', async () => {
    vi.mocked(listVoiceNoteSegments).mockResolvedValueOnce([seg('a', 1)])
    vi.mocked(acceptKairosProposal).mockResolvedValueOnce({ ok: false, reason: 'not_a_proposal' })
    expect(await confirmVoiceNote('u1', 'N')).toEqual({ noteId: 'N', parts: 4, accepted: 0 })

    vi.mocked(listVoiceNoteSegments).mockResolvedValueOnce([])
    expect(await confirmVoiceNote('u1', 'N')).toBeNull()
  })
})
