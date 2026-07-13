'use server'

import { z } from 'zod'
import { requireAuth } from '@/lib/actions/helpers'
import { getKairosInbox } from '@/lib/data/inbox'
import { acceptProposal, archiveMemory, findMemoryById } from '@/lib/data/memories'
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
  const result = await acceptProposal(memoryIdSchema.parse(memoryId), userId, { pin: false })

  if (!result) throw new Error('Proposal not found')
  if (!result.ok) throw new Error('Memory is not a pending proposal')
  return { id: result.memory.id }
}

export async function dismissKairosInboxProposal(memoryId: string) {
  const userId = await requireAuth()
  const id = memoryIdSchema.parse(memoryId)
  const proposal = await findMemoryById(id, userId)
  const metadata = (proposal?.sourceMetadata ?? {}) as Record<string, unknown>

  if (!proposal || proposal.type !== 'inbound' || metadata.status !== 'pending') {
    throw new Error('Proposal not found')
  }

  const archived = await archiveMemory(id, userId)
  if (!archived) throw new Error('Proposal not found')
  return { id: archived.id }
}
