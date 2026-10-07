import { beforeEach, describe, expect, it, vi } from 'vitest'

// Card garden proposals reach the inbox from their own 'trace' listing (which
// listMemories hides), lead the proposals, and drop out once expired.

vi.mock('@/lib/data/ask', () => ({ listOpenKairosAsks: vi.fn(async () => []) }))
vi.mock('@/lib/data/voice-samples', () => ({ listPendingVoiceSamples: vi.fn(async () => []) }))
vi.mock('@/lib/data/card-tree-proposals', () => ({ listPendingCardTrees: vi.fn(async () => []) }))
vi.mock('@/lib/data/card-garden-proposals', () => ({ listPendingCardGardens: vi.fn() }))
vi.mock('@/lib/data/memories', () => ({ listMemories: vi.fn(async () => []) }))

import { listPendingCardGardens } from '@/lib/data/card-garden-proposals'
import { listMemories } from '@/lib/data/memories'
import { getKairosInbox } from '../inbox'

const NOW = new Date('2026-10-06T12:00:00.000Z')
const pick = {
  isoWeek: '2026-W41', taskId: 't-1', taskName: 'Old spike', projectId: 'p-1', projectName: 'Beta', columnName: 'Live', ageDays: 60,
  action: 'kill', reason: 'Untouched for two months.', mergeWith: null, parkColumn: null, doneColumn: null,
}
const row = (id: string, meta: Record<string, unknown>) => ({ id, title: `Card garden ${id}`, summary: 's', createdAt: NOW, sourceMetadata: meta })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listMemories).mockResolvedValue([])
})

describe('getKairosInbox — card garden', () => {
  it('lists pending card garden proposals ahead of plain proposals, and hides expired or malformed ones', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      { id: 'plain', title: 'Plain', summary: null, type: 'inbound', source: 'cron', sourceMetadata: { status: 'pending' }, createdAt: NOW } as never,
    ])
    vi.mocked(listPendingCardGardens).mockResolvedValue([
      row('g-1', { kind: 'card_garden', status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z', cardGarden: pick }),
      row('g-old', { kind: 'card_garden', status: 'pending', expiresAt: '2026-10-01T00:00:00.000Z', cardGarden: pick }),
      row('g-bad', { kind: 'card_garden', status: 'pending', expiresAt: '2026-10-13T12:00:00.000Z', cardGarden: { taskId: 't-1' } }),
    ] as never)
    const { items } = await getKairosInbox('u-1', NOW)
    expect(items.map((i) => i.id)).toEqual(['g-1', 'plain'])
    expect(items[0]).toMatchObject({ kind: 'proposal', cardGarden: { ...pick, expiresAt: '2026-10-13T12:00:00.000Z' } })
  })

  it('a failing card garden listing never breaks the inbox', async () => {
    vi.mocked(listPendingCardGardens).mockRejectedValue(new Error('db down'))
    await expect(getKairosInbox('u-1', NOW)).resolves.toEqual({ items: [] })
  })
})
