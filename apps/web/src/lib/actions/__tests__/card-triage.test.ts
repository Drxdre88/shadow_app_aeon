import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/actions/helpers', () => ({
  requireMember: vi.fn(),
  requireOwner: vi.fn(),
  requireEditor: vi.fn(),
}))
vi.mock('@/lib/data/card-triage', () => ({
  findCardTriageBoard: vi.fn(),
  findTriageCard: vi.fn(),
  replaceCardTriage: vi.fn(),
  setProjectCardTriage: vi.fn(),
}))
vi.mock('@/lib/data/labels', () => ({ addLabelToTask: vi.fn() }))
vi.mock('@/lib/data/tasks', () => ({ updateTask: vi.fn() }))
vi.mock('@/lib/data/activity', () => ({ emitActivity: vi.fn().mockResolvedValue(undefined) }))

import { requireEditor, requireMember, requireOwner } from '@/lib/actions/helpers'
import {
  findCardTriageBoard,
  findTriageCard,
  replaceCardTriage,
  setProjectCardTriage,
} from '@/lib/data/card-triage'
import { addLabelToTask } from '@/lib/data/labels'
import { updateTask } from '@/lib/data/tasks'
import { getCardTriageSetting, resolveCardTriage, setCardTriage } from '@/lib/actions/card-triage'
import type { CardTriage } from '@/lib/kairos/triage/types'

const P = 'proj-1'
const T = 'task-1'
const OWNER = 'user-owner'

const triage = (over: Partial<CardTriage> = {}): CardTriage => ({
  v: 1, jobId: 'job-1', at: '2026-10-05T10:00:00.000Z',
  labels: [{ id: 'lab-bug', reason: 'A defect', status: 'pending' }],
  priority: { value: 'high', reason: 'Blocks sign-in', status: 'pending' },
  duplicates: [{ taskId: 'old-1', name: 'Old', reason: 'Same bug', status: 'pending' }],
  ...over,
})

function cardWith(t: CardTriage | null, priority = 'medium') {
  return { id: T, priority, metadata: t ? { triage: t, other: 1 } : {} }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireMember).mockResolvedValue(OWNER)
  vi.mocked(requireOwner).mockResolvedValue(OWNER)
  vi.mocked(requireEditor).mockResolvedValue(OWNER)
  vi.mocked(findTriageCard).mockResolvedValue(cardWith(triage()))
  vi.mocked(replaceCardTriage).mockResolvedValue(true)
  vi.mocked(updateTask).mockResolvedValue({ name: 'Card' } as never)
})

describe('card sorting switch', () => {
  it('reports the state and whether this caller created the board', async () => {
    vi.mocked(findCardTriageBoard).mockResolvedValue({ id: P, userId: OWNER, name: 'B', settings: { kairosTriage: 'on' } })
    expect(await getCardTriageSetting(P)).toEqual({ on: true, canToggle: true })
    vi.mocked(requireMember).mockResolvedValue('member-2')
    expect(await getCardTriageSetting(P)).toEqual({ on: true, canToggle: false })
  })

  it('switches through the owner guard and the creator-scoped writer', async () => {
    vi.mocked(setProjectCardTriage).mockResolvedValue({ id: P, settings: { kairosTriage: 'on' } })
    expect(await setCardTriage(P, true)).toEqual({ projectId: P, on: true })
    expect(requireOwner).toHaveBeenCalledWith(P)
    expect(setProjectCardTriage).toHaveBeenCalledWith(P, OWNER, true)
  })

  it('refuses a realm owner who did not create the board, and non-owners entirely', async () => {
    vi.mocked(setProjectCardTriage).mockResolvedValue(null as never)
    await expect(setCardTriage(P, true)).rejects.toThrow('Only the person who created this board')
    vi.mocked(requireOwner).mockRejectedValue(new Error('Only the project owner can change this'))
    await expect(setCardTriage(P, false)).rejects.toThrow('Only the project owner')
  })

  it('validates input', async () => {
    await expect(setCardTriage(P, 'yes' as never)).rejects.toThrow(ZodError)
  })
})

describe('resolveCardTriage', () => {
  it('accepting a label adds it to the card and records the decision', async () => {
    const out = await resolveCardTriage(P, T, { kind: 'label', ref: 'lab-bug', decision: 'accept' })
    expect(requireEditor).toHaveBeenCalledWith(P)
    expect(addLabelToTask).toHaveBeenCalledWith(T, 'lab-bug', P)
    expect(out.applied).toBe(true)
    expect(out.triage.labels[0].status).toBe('accepted')
    const [, , expectedRaw, next] = vi.mocked(replaceCardTriage).mock.calls[0]
    expect(expectedRaw).toEqual(triage())
    expect(next.labels[0].status).toBe('accepted')
  })

  it('accepting a priority sets it on the card', async () => {
    const out = await resolveCardTriage(P, T, { kind: 'priority', decision: 'accept' })
    expect(updateTask).toHaveBeenCalledWith(T, P, expect.objectContaining({ priority: 'high' }))
    expect(out.triage.priority?.status).toBe('accepted')
  })

  it('dismissing changes nothing on the card; a duplicate accept only records the link', async () => {
    await resolveCardTriage(P, T, { kind: 'label', ref: 'lab-bug', decision: 'dismiss' })
    const dup = await resolveCardTriage(P, T, { kind: 'duplicate', ref: 'old-1', decision: 'accept' })
    expect(addLabelToTask).not.toHaveBeenCalled()
    expect(updateTask).not.toHaveBeenCalled()
    expect(dup).toMatchObject({ applied: false, triage: { duplicates: [{ taskId: 'old-1', status: 'accepted' }] } })
  })

  it('a second decision on the same item is a no-op', async () => {
    vi.mocked(findTriageCard).mockResolvedValue(cardWith(triage({ labels: [{ id: 'lab-bug', reason: 'r', status: 'dismissed' }] })))
    const out = await resolveCardTriage(P, T, { kind: 'label', ref: 'lab-bug', decision: 'accept' })
    expect(out.applied).toBe(false)
    expect(addLabelToTask).not.toHaveBeenCalled()
    expect(replaceCardTriage).not.toHaveBeenCalled()
  })

  it('retries once when another tab changed the card, then gives up with a plain message', async () => {
    vi.mocked(replaceCardTriage).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(resolveCardTriage(P, T, { kind: 'duplicate', ref: 'old-1', decision: 'dismiss' })).resolves.toBeTruthy()
    vi.mocked(replaceCardTriage).mockResolvedValue(false)
    await expect(resolveCardTriage(P, T, { kind: 'duplicate', ref: 'old-1', decision: 'dismiss' })).rejects.toThrow('please try again')
  })

  it('rejects viewers, unknown items, cards without suggestions and bad input', async () => {
    await expect(resolveCardTriage(P, T, { kind: 'label', ref: 'nope', decision: 'accept' })).rejects.toThrow('no longer on the card')
    vi.mocked(findTriageCard).mockResolvedValue(cardWith(null))
    await expect(resolveCardTriage(P, T, { kind: 'priority', decision: 'accept' })).rejects.toThrow('no suggestions')
    await expect(resolveCardTriage(P, T, { kind: 'colour' as never, decision: 'accept' })).rejects.toThrow(ZodError)
    vi.mocked(requireEditor).mockRejectedValue(new Error('Viewers cannot modify this project'))
    await expect(resolveCardTriage(P, T, { kind: 'priority', decision: 'accept' })).rejects.toThrow('Viewers')
  })

  it('a label deleted since the suggestion fails with a plain message', async () => {
    vi.mocked(addLabelToTask).mockRejectedValue(new Error('Label not found in project'))
    await expect(resolveCardTriage(P, T, { kind: 'label', ref: 'lab-bug', decision: 'accept' })).rejects.toThrow('That label no longer exists')
    expect(replaceCardTriage).not.toHaveBeenCalled()
  })
})
