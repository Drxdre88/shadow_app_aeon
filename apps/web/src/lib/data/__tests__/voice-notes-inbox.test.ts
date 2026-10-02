import { beforeEach, describe, expect, it, vi } from 'vitest'

// The inbox collapses a voice note's pending parts into ONE item, at the
// position of its first listed part, so a long dictation (up to ~100 parts)
// is confirmed or discarded as a whole.

vi.mock('@/lib/data/ask', () => ({
  getPendingKairosAsk: vi.fn().mockResolvedValue(null),
  listOpenKairosAsks: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/data/memories', () => ({ listMemories: vi.fn() }))

import { listMemories } from '@/lib/data/memories'
import { getKairosInbox } from '../inbox'

beforeEach(() => vi.clearAllMocks())

const createdAt = new Date('2026-10-02T09:00:00Z')

function segment(noteId: string, part: number, of: number, status = 'pending') {
  return {
    id: `${noteId}-seg-${part}`,
    title: `Voice note ${part}/${of}: Part ${part}.`,
    summary: `Part ${part}.`,
    type: 'inbound',
    createdAt,
    sourceMetadata: {
      introspection: true,
      kind: 'reflection',
      status,
      voiceNote: { noteId, part, of, hash: 'h' },
      origin: { kind: 'agent', via: 'mcp' },
    },
  }
}

function proposal(id: string) {
  return { id, title: `Proposal ${id}`, summary: null, type: 'inbound', createdAt, sourceMetadata: { introspection: true, status: 'pending' } }
}

describe('voice notes in the inbox', () => {
  it('shows a note as ONE item at its first part\'s position, parts in order, verbatim excerpt as summary', async () => {
    vi.mocked(listMemories).mockResolvedValue([
      proposal('before'),
      segment('N', 2, 3),
      proposal('between'),
      segment('N', 1, 3),
      segment('N', 3, 3),
      proposal('after'),
    ] as never)

    const { items } = await getKairosInbox('u1')

    expect(listMemories).toHaveBeenCalledWith('u1', { type: 'inbound', limit: 200 })
    expect(items.map((i) => i.kind === 'voice_note' ? `voice:${i.noteId}` : i.id)).toEqual(['before', 'voice:N', 'between', 'after'])
    const note = items[1]
    expect(note).toMatchObject({ kind: 'voice_note', id: 'N', noteId: 'N', parts: 3, title: 'Voice note · 3 parts', summary: 'Part 1.' })
    if (note.kind !== 'voice_note') throw new Error('not grouped')
    expect(note.segments.map((s) => s.voiceNote?.part)).toEqual([1, 2, 3])
    expect(note.pendingIds).toEqual(['N-seg-1', 'N-seg-2', 'N-seg-3'])
  })

  it('a partly handled note lists only its waiting parts against the total', async () => {
    vi.mocked(listMemories).mockResolvedValue([segment('N', 1, 4, 'accepted'), segment('N', 3, 4), segment('N', 4, 4)] as never)

    const { items } = await getKairosInbox('u1')

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'voice_note', parts: 4, pendingIds: ['N-seg-3', 'N-seg-4'], summary: 'Part 3.' })
  })

  it('keeps separate notes apart and leaves ordinary proposals untouched', async () => {
    vi.mocked(listMemories).mockResolvedValue([segment('A', 1, 2), segment('B', 1, 1), segment('A', 2, 2), proposal('p')] as never)

    const { items } = await getKairosInbox('u1')

    expect(items.map((i) => i.kind === 'voice_note' ? `voice:${i.noteId}:${i.segments.length}` : i.id)).toEqual(['voice:A:2', 'voice:B:1', 'p'])
    expect(items[1]).toMatchObject({ title: 'Voice note' })
    expect(items[2]).not.toHaveProperty('voiceNote')
  })
})
