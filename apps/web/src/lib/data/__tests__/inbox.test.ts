import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/ask', () => ({
  getPendingKairosAsk: vi.fn(),
}))

vi.mock('@/lib/data/memories', () => ({
  listMemories: vi.fn(),
  listTodaysAdvisories: vi.fn(),
  findMemoryById: vi.fn(),
  archiveMemory: vi.fn(),
  acceptProposal: vi.fn(),
}))

import { getPendingKairosAsk, type KairosAskRow } from '@/lib/data/ask'
import {
  acceptProposal,
  archiveMemory,
  findMemoryById,
  listMemories,
  listTodaysAdvisories,
} from '@/lib/data/memories'
import { acceptInboxProposal, dismissInboxMemory, getKairosInbox } from '../inbox'

type ListedMemory = Awaited<ReturnType<typeof listMemories>>[number]
type FoundMemory = Awaited<ReturnType<typeof findMemoryById>>

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
  }
}

function foundMemory(overrides: Partial<Record<string, unknown>> = {}): FoundMemory {
  return {
    id: 'mem-1',
    type: 'inbound',
    archivedAt: null,
    sourceMetadata: { kairosSpeak: true, status: 'pending' },
    ...overrides,
  } as unknown as FoundMemory
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

describe('dismissInboxMemory', () => {
  it('archives a pending inbound memory', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory())
    vi.mocked(archiveMemory).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    const result = await dismissInboxMemory(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: true, id: 'mem-1' })
    expect(archiveMemory).toHaveBeenCalledWith('mem-1', USER_ID)
  })

  it('is idempotent: an already-archived memory reports already_resolved', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ archivedAt: new Date() }))

    const result = await dismissInboxMemory(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: false, reason: 'already_resolved' })
    expect(archiveMemory).not.toHaveBeenCalled()
  })

  it('rejects non-inbound or missing memories as not_found', async () => {
    vi.mocked(findMemoryById).mockResolvedValue(null as unknown as FoundMemory)
    await expect(dismissInboxMemory(USER_ID, 'mem-x')).resolves.toEqual({ ok: false, reason: 'not_found' })

    vi.mocked(findMemoryById).mockResolvedValue(foundMemory({ type: 'note' }))
    await expect(dismissInboxMemory(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('acceptInboxProposal', () => {
  it('promotes via acceptProposal', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({ ok: true, memory: foundMemory() as never })
    const result = await acceptInboxProposal(USER_ID, 'mem-1')
    expect(result).toEqual({ ok: true, id: 'mem-1' })
    expect(acceptProposal).toHaveBeenCalledWith('mem-1', USER_ID, { pin: false })
  })

  it('maps a non-pending proposal to already_resolved', async () => {
    vi.mocked(acceptProposal).mockResolvedValue({ ok: false, reason: 'not_a_proposal' })
    await expect(acceptInboxProposal(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'already_resolved' })
  })

  it('maps a missing memory to not_found', async () => {
    vi.mocked(acceptProposal).mockResolvedValue(null)
    await expect(acceptInboxProposal(USER_ID, 'mem-1')).resolves.toEqual({ ok: false, reason: 'not_found' })
  })
})
