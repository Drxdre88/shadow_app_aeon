import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/helpers', () => { const requireAuth = vi.fn(); return { requireAuth, requireVorath: requireAuth } })
vi.mock('@/lib/data/voice-notes', () => ({ discardVoiceNote: vi.fn() }))
vi.mock('@/lib/kairos/voice-note-confirm', () => ({ confirmVoiceNote: vi.fn() }))

import { requireAuth } from '@/lib/actions/helpers'
import { discardVoiceNote as discardData } from '@/lib/data/voice-notes'
import { confirmVoiceNote as confirmFlow } from '@/lib/kairos/voice-note-confirm'
import { confirmVoiceNote, discardVoiceNote } from '../kairos-voice'

const NOTE = '00000000-0000-4000-8000-0000000000aa'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue('u1')
})

describe('kairos-voice actions', () => {
  it('confirms for the signed-in owner and returns the summary', async () => {
    vi.mocked(confirmFlow).mockResolvedValue({ noteId: NOTE, parts: 3, accepted: 3 })
    expect(await confirmVoiceNote(NOTE)).toEqual({ noteId: NOTE, parts: 3, accepted: 3 })
    expect(confirmFlow).toHaveBeenCalledWith('u1', NOTE)
  })

  it('discards for the signed-in owner', async () => {
    vi.mocked(discardData).mockResolvedValue({ noteId: NOTE, parts: 3, discarded: 2 })
    expect(await discardVoiceNote(NOTE)).toEqual({ noteId: NOTE, parts: 3, discarded: 2 })
    expect(discardData).toHaveBeenCalledWith('u1', NOTE)
  })

  it('refuses without a session and never touches the data', async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error('Unauthorized'))
    await expect(confirmVoiceNote(NOTE)).rejects.toThrow('Unauthorized')
    await expect(discardVoiceNote(NOTE)).rejects.toThrow('Unauthorized')
    expect(confirmFlow).not.toHaveBeenCalled()
    expect(discardData).not.toHaveBeenCalled()
  })

  it('rejects a malformed id and reports an unknown note', async () => {
    await expect(confirmVoiceNote('nope')).rejects.toThrow()
    vi.mocked(confirmFlow).mockResolvedValue(null)
    await expect(confirmVoiceNote(NOTE)).rejects.toThrow('Voice note not found')
  })
})
