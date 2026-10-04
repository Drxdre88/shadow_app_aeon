import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The weekly carrying card: London window (BST and GMT), once per ISO week,
// skipped when empty, force:false + digest:true, throttled → retried.

const h = vi.hoisted(() => ({
  model: null as unknown,
  mutations: [] as unknown[],
  deliver: vi.fn(),
}))
vi.mock('@/lib/data/kairos-owner-model', () => ({
  readKairosOwnerModel: vi.fn(async () => h.model),
  mutateKairosOwnerModel: vi.fn(async (_u: string, mutate: (m: unknown) => { state: unknown; result: unknown }) => {
    const { state, result } = mutate(h.model)
    if (state) { h.model = state; h.mutations.push(state) }
    return result
  }),
}))
vi.mock('@/lib/kairos/speak', () => ({ deliverKairosSpeak: h.deliver }))

import type { KairosOwnerModel, OwnerItem } from '@/lib/data/validators/kairos-owner-model'
import { ownerModelLane } from '@/lib/kairos/moment/lanes/owner-model'
import { CARRYING_CARD_FOOTER, cardWindow, remainingKeyboard, renderCarryingCard } from '../card'
import { runCarryingCardSweep } from '../card-sweep'
import { emptyOwnerModel } from '../status'

function item(seq: number, kind: OwnerItem['kind'], text: string, extra: Partial<OwnerItem> = {}): OwnerItem {
  return {
    id: `i${seq}`, seq, kind, text, domain: 'general', status: 'held',
    firstSeenAt: '2026-09-30T08:00:00.000Z', lastConfirmedAt: '2026-09-30T08:00:00.000Z',
    ...(kind === 'state' ? { expiresAt: '2026-10-10T08:00:00.000Z' } : {}),
    supportDays: [], confirmations: [], ...extra,
  }
}

const model = (items: OwnerItem[], extra: Partial<KairosOwnerModel> = {}): KairosOwnerModel => ({ ...emptyOwnerModel(), items, ...extra })
const ITEMS = [
  item(1, 'state', 'stressed about the launch'),
  item(2, 'trait', 'values directness'),
  item(3, 'trait', 'prefers mornings', { status: 'candidate' }),
  item(4, 'trait', 'second candidate', { status: 'candidate', lastConfirmedAt: '2026-09-29T08:00:00.000Z' }),
]
// Sunday 4 Oct 2026, 19:00 BST (18:00 UTC).
const SUNDAY_EVENING = new Date('2026-10-04T18:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  h.model = model(ITEMS)
  h.mutations = []
  h.deliver.mockResolvedValue({ status: 200, body: { id: 'mem-1', delivered: { inbox: true, telegram: true } } })
})

afterEach(() => {
  delete process.env.KAIROS_OWNER_MODEL
})

describe('cardWindow (Sunday 18:00 → Monday 12:00 London)', () => {
  it('BST: opens 18:00 London Sunday (17:00Z), closes 12:00 London Monday (11:00Z); week = the Monday', () => {
    expect(cardWindow(new Date('2026-10-04T16:59:00Z'))).toBeNull()
    expect(cardWindow(new Date('2026-10-04T17:00:00Z'))).toEqual({ isoWeek: '2026-W41' })
    expect(cardWindow(new Date('2026-10-05T10:59:00Z'))).toEqual({ isoWeek: '2026-W41' })
    expect(cardWindow(new Date('2026-10-05T11:00:00Z'))).toBeNull()
  })

  it('GMT: opens 18:00Z Sunday, closes 12:00Z Monday', () => {
    expect(cardWindow(new Date('2026-11-01T17:59:00Z'))).toBeNull()
    expect(cardWindow(new Date('2026-11-01T18:00:00Z'))).toEqual({ isoWeek: '2026-W45' })
    expect(cardWindow(new Date('2026-11-02T11:59:00Z'))).toEqual({ isoWeek: '2026-W45' })
    expect(cardWindow(new Date('2026-11-02T12:00:00Z'))).toBeNull()
  })
})

describe('renderCarryingCard', () => {
  it('is deterministic: C-numbered lines, one candidate, footer, small callback data', () => {
    const card = renderCarryingCard(model(ITEMS), SUNDAY_EVENING)!
    expect(card.message).toBe([
      'Here is my working read of what you are carrying. Correct anything that is off.',
      '',
      'C1 · stressed about the launch (since 30/09, lapses 10/10)',
      'C2 · values directness (lasting)',
      'C3 · prefers mornings — right?',
      '',
      CARRYING_CARD_FOOTER,
    ].join('\n'))
    expect(card.seqs).toEqual([1, 2, 3])
    expect(card.keyboard[0]).toEqual([{ text: 'C1 still', callback_data: 'om1:k:1' }, { text: 'C1 over', callback_data: 'om1:x:1' }])
    expect(card.keyboard[1]![1]).toEqual({ text: 'C2 wrong', callback_data: 'om1:x:2' })
    for (const row of card.keyboard) for (const b of row) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64)
  })

  it('asks a long-running state whether it is part of him', () => {
    const long = item(5, 'state', 'grinding on the rewrite', { firstSeenAt: '2026-08-01T08:00:00.000Z' })
    expect(renderCarryingCard(model([long]), SUNDAY_EVENING)!.message).toContain('— still a phase, or part of you?')
  })

  it('remaining keyboard drops acted rows and keeps Dismiss', () => {
    const m = model(ITEMS, { cards: [{ isoWeek: '2026-W41', at: SUNDAY_EVENING.toISOString(), status: 'sent', memoryId: 'mem-1', seqs: [1, 2, 3], acted: [1] }] })
    const rows = remainingKeyboard(m, 1, SUNDAY_EVENING)
    expect(rows.map((r) => r[0]!.callback_data)).toEqual(['om1:k:2', 'om1:k:3', 'dismiss:mem-1'])
  })
})

describe('runCarryingCardSweep', () => {
  it('sends once per week with force:false, digest:true, the week external id and the keyboard', async () => {
    expect(await runCarryingCardSweep('u', SUNDAY_EVENING)).toEqual({ ownerCard: { status: 'sent', isoWeek: '2026-W41' } })
    const [uid, input, opts] = h.deliver.mock.calls[0]
    expect(uid).toBe('u')
    expect(input).toMatchObject({ title: "What I think you're carrying", kind: 'notify', force: false, digest: true, externalId: 'kairos-carrying:2026-W41' })
    expect(opts.telegramKeyboard).toHaveLength(3)
    expect((h.model as KairosOwnerModel).cards).toEqual([{ isoWeek: '2026-W41', at: SUNDAY_EVENING.toISOString(), status: 'sent', memoryId: 'mem-1', seqs: [1, 2, 3] }])
    expect(await runCarryingCardSweep('u', new Date('2026-10-05T08:00:00Z'))).toBeNull()
    expect(h.deliver).toHaveBeenCalledTimes(1)
  })

  it('records a 429 as throttled and retries at the next sweep in the window', async () => {
    h.deliver.mockResolvedValueOnce({ status: 429, body: { error: 'throttled' } })
    expect(await runCarryingCardSweep('u', SUNDAY_EVENING)).toEqual({ ownerCard: { status: 'throttled', isoWeek: '2026-W41', reason: 'throttled' } })
    expect(await runCarryingCardSweep('u', new Date('2026-10-04T19:00:00Z'))).toEqual({ ownerCard: { status: 'sent', isoWeek: '2026-W41' } })
    expect((h.model as KairosOwnerModel).cards).toHaveLength(1)
  })

  it('records an empty week as skipped_empty and sends nothing', async () => {
    h.model = model([item(1, 'state', 'old mood', { expiresAt: '2026-10-01T00:00:00.000Z' })])
    expect(await runCarryingCardSweep('u', SUNDAY_EVENING)).toEqual({ ownerCard: { status: 'skipped_empty', isoWeek: '2026-W41' } })
    expect(h.deliver).not.toHaveBeenCalled()
    expect(await runCarryingCardSweep('u', new Date('2026-10-04T20:00:00Z'))).toBeNull()
  })

  it('outside the window does nothing', async () => {
    expect(await runCarryingCardSweep('u', new Date('2026-10-07T18:00:00Z'))).toBeNull()
    expect(h.mutations).toEqual([])
  })

  it('the lane sweep is null (no sweep JSON keys) unless KAIROS_OWNER_MODEL=1', async () => {
    expect(await ownerModelLane.sweep!('u', SUNDAY_EVENING)).toBeNull()
    process.env.KAIROS_OWNER_MODEL = 'observe'
    expect(await ownerModelLane.sweep!('u', SUNDAY_EVENING)).toBeNull()
    process.env.KAIROS_OWNER_MODEL = '1'
    expect(await ownerModelLane.sweep!('u', SUNDAY_EVENING)).toEqual({ ownerCard: { status: 'sent', isoWeek: '2026-W41' } })
  })
})
