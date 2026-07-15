'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/actions/helpers'
import { acceptInboxProposal, dismissInboxMemory, getKairosInbox } from '@/lib/data/inbox'
import { answerKairosAsk } from '@/lib/kairos/ask'

const memoryIdSchema = z.string().uuid()
const answerSchema = z.string().trim().min(1).max(10_000)

export async function listKairosInbox() {
  const userId = await requireAuth()
  return getKairosInbox(userId)
}

export async function answerKairosInboxAsk(questionMemoryId: string, answer: string) {
  const userId = await requireAuth()
  const result = await answerKairosAsk(
    userId,
    memoryIdSchema.parse(questionMemoryId),
    answerSchema.parse(answer),
  )

  if ('error' in result) {
    throw new Error(result.error === 'not_found' ? 'Kairos question not found' : 'Dominion not found')
  }

  return result
}

export async function acceptKairosInboxProposal(memoryId: string) {
  const userId = await requireAuth()
  const result = await acceptInboxProposal(userId, memoryIdSchema.parse(memoryId))

  if (!result.ok) {
    throw new Error(result.reason === 'not_found' ? 'Proposal not found' : 'Memory is not a pending proposal')
  }
  return { id: result.id }
}

export async function dismissKairosInboxProposal(memoryId: string) {
  const userId = await requireAuth()
  const result = await dismissInboxMemory(userId, memoryIdSchema.parse(memoryId))

  if (!result.ok) throw new Error('Proposal not found')
  return { id: result.id }
}
