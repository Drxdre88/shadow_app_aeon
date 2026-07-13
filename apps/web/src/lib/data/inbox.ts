import { getPendingKairosAsk } from '@/lib/data/ask'
import { listMemories } from '@/lib/data/memories'

export type KairosInboxProposal = {
  id: string
  title: string
  summary: string | null
  createdAt: Date
}

export async function getKairosInbox(userId: string) {
  const [ask, inbound] = await Promise.all([
    getPendingKairosAsk(userId),
    listMemories(userId, { type: 'inbound' }),
  ])

  const proposals: KairosInboxProposal[] = inbound
    .filter((memory) => {
      const metadata = (memory.sourceMetadata ?? {}) as Record<string, unknown>
      return metadata.status === 'pending'
    })
    .map(({ id, title, summary, createdAt }) => ({ id, title, summary, createdAt }))

  return { ask, proposals }
}
