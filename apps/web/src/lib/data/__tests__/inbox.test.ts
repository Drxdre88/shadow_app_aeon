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
  vi.mocked(getPendingKairosAsk).mockResolvedValue(null)
  vi.mocked(listMemories).mockResolvedValue([])
})

describe('getKairosInbox', () => {
  it('aggregates ask, notify and proposal kinds in pinned order', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(ask)
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending', urgency: 'high' }),
      listedMemory('prop-1', { introspection: true, status: 'pending' }),
      listedMemory('prop-accepted', { introspection: true, status: 'accepted' }),
    ])

    const { items } = await getKairosInbox(USER_ID)

    expect(getPendingKairosAsk).toHaveBeenCalledWith(USER_ID)
    expect(listMemories).toHaveBeenCalledWith(USER_ID, { type: 'inbound' })
    expect(items.map((i) => i.kind)).toEqual(['ask', 'notify', 'proposal'])
    expect(items[1]).toMatchObject({ kind: 'notify', id: 'notify-1', urgency: 'high' })
    expect(items[1]).not.toHaveProperty('daily')
    expect(items[2]).toMatchObject({ kind: 'proposal', id: 'prop-1', summary: 'Summary prop-1' })
  })

  it('pins the newest daily message ahead of every other notify and proposal, after the ask', async () => {
    vi.mocked(getPendingKairosAsk).mockResolvedValue(ask)
    const older = { ...listedMemory('daily-0', { kairosSpeak: true, status: 'pending', digest: true, externalId: 'kairos-daily:2026-07-12' }), createdAt: new Date('2026-07-12T07:00:00Z') }
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending' }),
      listedMemory('prop-1', { introspection: true, status: 'pending' }),
      listedMemory('daily-1', { kairosSpeak: true, status: 'pending', digest: true, externalId: 'kairos-daily:2026-07-13' }),
      older,
    ])
    const { items } = await getKairosInbox(USER_ID)
    expect(items.map((i) => i.id)).toEqual(['ask-1', 'daily-1', 'notify-1', 'prop-1', 'daily-0'])
    expect(items[1]).toMatchObject({ kind: 'notify', daily: true })
  })

  it('never lists the retired contradiction notices, even when still pending', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('contra-1', { contradictionCheck: true, kind: 'contradiction', status: 'pending' }),
      listedMemory('prop-1', { introspection: true, status: 'pending' }),
    ])
    const { items } = await getKairosInbox(USER_ID)
    expect(items.map((i) => i.id)).toEqual(['prop-1'])
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

  it('carries idea details and puts tournament survivors ahead of other proposals', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('prop-raw', { introspection: true, status: 'pending' }),
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending' }),
      listedMemory('idea-1', {
        introspection: true,
        status: 'pending',
        kind: 'idea',
        idea: { claim: 'Cut the DE PPA scope', why: 'It blocks go-live', nextStep: 'Ask the desk', survivedBecause: 'Backed by 3 board pages' },
      }),
    ])

    const { items } = await getKairosInbox(USER_ID)
    expect(items.map((i) => i.id)).toEqual(['idea-1', 'prop-raw', 'notify-1'])
    expect(items[0]).toMatchObject({
      kind: 'proposal',
      idea: { claim: 'Cut the DE PPA scope', why: 'It blocks go-live', nextStep: 'Ask the desk', survivedBecause: 'Backed by 3 board pages' },
    })
    expect(items[1]).not.toHaveProperty('idea')
  })

  it('appends ideas after notifies when no other proposal is pending', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      listedMemory('notify-1', { kairosSpeak: true, status: 'pending' }),
      listedMemory('idea-1', { status: 'pending', kind: 'idea', idea: { claim: 'x', why: 'y', nextStep: 'z' } }),
    ])
    const { items } = await getKairosInbox(USER_ID)
    expect(items.map((i) => i.id)).toEqual(['notify-1', 'idea-1'])
    expect(items[1]).toMatchObject({ idea: { survivedBecause: null } })
  })
})
