'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/actions/helpers'
import { discardVoiceNote as discardVoiceNoteData } from '@/lib/data/voice-notes'
import { confirmVoiceNote as confirmVoiceNoteFlow } from '@/lib/kairos/voice-note-confirm'

const noteIdSchema = z.string().uuid()

export async function confirmVoiceNote(noteId: string) {
  const userId = await requireAuth()
  const result = await confirmVoiceNoteFlow(userId, noteIdSchema.parse(noteId))
  if (!result) throw new Error('Voice note not found')
  return result
}

export async function discardVoiceNote(noteId: string) {
  const userId = await requireAuth()
  const result = await discardVoiceNoteData(userId, noteIdSchema.parse(noteId))
  if (!result) throw new Error('Voice note not found')
  return result
}
