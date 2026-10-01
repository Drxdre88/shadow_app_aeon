import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/ask', () => ({
  getPendingKairosAsk: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  listMemories: vi.fn(),
  listTodaysAdvisories: vi.fn(),
}))

import { getPendingKairosAsk, type KairosAskRow } from '@/lib/data/ask'
import { listMemories, listTodaysAdvisories } from '@/lib/data/memories'
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

function listedMemory(id: string, sourceMetadata: Record<string, unknown>): ListedMemory {
  return {
    id,
    title: `Item ${id}`,
    summary: `Summary ${id}`,
    type: 'inbound',
    source: 'cron',
    sourceMetadata,
    createdAt: new Date('2026-07-13T09:00:00Z'),
    updatedAt: new Date('2026-07-13T09:00:00Z'),
    realmId: null,
    projectId: null,
    taskId: null,
    tags: [],
    pinned: false,
    confidence: 0.6,
    standing: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listTodaysAdvisories).mockResolvedValue([])
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
  vi.mocked(listMemories).mockResolvedValue([])
})

describe('getKairosInbox', () => {
  it('aggregates brief, ask, notify and proposal kinds in pinned order', async () => {
    vi.mocked(listTodaysAdvisories).mockResolvedValue([{
      id: 'brief-1',
      title: '2026-07-13 · KAIROS briefing',
      bodyMd: '## State\nAll systems go.',
      createdAt: new Date('2026-07-13T07:00:00Z'),
      dominionId: 'dom-1',
      dominionName: 'KAIROS',
      dominionColor: '#8b5cf6',
    }])
    vi.mocked(getPendingKairosAsk).mockResolvedValue(ask)
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending', urgency: 'high' }),
      listedMemory('prop-1', { introspection: true, status: 'pending' }),
      listedMemory('prop-accepted', { introspection: true, status: 'accepted' }),
    ])

    const { items } = await getKairosInbox(USER_ID)

    expect(getPendingKairosAsk).toHaveBeenCalledWith(USER_ID)
    expect(listMemories).toHaveBeenCalledWith(USER_ID, { type: 'inbound' })
    expect(listTodaysAdvisories).toHaveBeenCalledWith(USER_ID)
    expect(items.map((i) => i.kind)).toEqual(['brief', 'ask', 'notify', 'proposal'])
    expect(items[0]).toMatchObject({
      kind: 'brief',
      id: 'brief-1',
      bodyMd: '## State\nAll systems go.',
      dominionName: 'KAIROS',
    })
    expect(items[2]).toMatchObject({ kind: 'notify', id: 'notify-1', urgency: 'high' })
    expect(items[3]).toMatchObject({ kind: 'proposal', id: 'prop-1', summary: 'Summary prop-1' })
  })

  it('defaults notify urgency to normal when metadata carries junk', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending', urgency: 'apocalyptic' }),
    ])

    const { items } = await getKairosInbox(USER_ID)
    expect(items).toEqual([expect.objectContaining({ kind: 'notify', urgency: 'normal' })])
  })

  it('returns an empty inbox when no source has pending work', async () => {
    await expect(getKairosInbox(USER_ID)).resolves.toEqual({ items: [] })
  })
})
