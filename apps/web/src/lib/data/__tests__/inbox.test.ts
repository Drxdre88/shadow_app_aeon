import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/ask', () => ({
  getPendingKairosAsk: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  listMemories: vi.fn(),
}))

import { getPendingKairosAsk, type KairosAskRow } from '@/lib/data/ask'
import { listMemories } from '@/lib/data/memories'
import { getKairosInbox } from '../inbox'

type ListedMemory = Awaited<ReturnType<typeof listMemories>>[number]

const USER_ID = 'user-1'

const ask: KairosAskRow = {
  id: 'ask-1',
  title: 'What should change?',
  summary: 'What should change?',
  dominionId: null,
  createdAt: new Date('2026-07-13T08:00:00Z'),
  kairosAsk: {
    status: 'pending',
    aetherMemoryId: 'aether-1',
    sourceThoughtId: null,
    sourceMemoryIds: [],
    dominionId: null,
    askedAt: '2026-07-13T08:00:00.000Z',
  },
}

function listedMemory(id: string, status: string): ListedMemory {
  return {
    id,
    title: `Proposal ${id}`,
    summary: `Summary ${id}`,
    type: 'inbound',
    source: 'cron',
    sourceMetadata: { introspection: true, status },
    createdAt: new Date('2026-07-13T09:00:00Z'),
    updatedAt: new Date('2026-07-13T09:00:00Z'),
    realmId: null,
    projectId: null,
    taskId: null,
    tags: ['proposal'],
    pinned: false,
    confidence: 0.6,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getKairosInbox', () => {
  it('aggregates the existing Ask and inbound-memory queries', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(ask)
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('pending', 'pending'),
      listedMemory('accepted', 'accepted'),
    ])

    const result = await getKairosInbox(USER_ID)

    expect(getPendingKairosAsk).toHaveBeenCalledWith(USER_ID)
    expect(listMemories).toHaveBeenCalledWith(USER_ID, { type: 'inbound' })
    expect(result.ask).toBe(ask)
    expect(result.proposals).toEqual([{
      id: 'pending',
      title: 'Proposal pending',
      summary: 'Summary pending',
      createdAt: new Date('2026-07-13T09:00:00Z'),
    }])
  })

  it('returns an empty inbox when neither source has pending work', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
    vi.mocked(listMemories).mockResolvedValue([])

    await expect(getKairosInbox(USER_ID)).resolves.toEqual({ ask: null, proposals: [] })
  })
})
