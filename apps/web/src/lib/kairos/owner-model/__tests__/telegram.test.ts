import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Owner-model corrections from Telegram: C-number commands (every line must be
// one), card buttons (om1:k / om1:x), and the shared correction entry point
// (today log; one operator reflection for free text only).

const h = vi.hoisted(() => ({
  model: null as unknown,
  captureMemory: vi.fn(),
  recordToday: vi.fn(),
  answerCallbackQuery: vi.fn(),
  editMessageText: vi.fn(),
  markKairosSpeaksReplied: vi.fn(),
}))
vi.mock('@/lib/data/memory-candidates', () => ({}))
vi.mock('@/lib/data/kairos-owner-model', () => ({
  readKairosOwnerModel: vi.fn(async () => h.model),
  mutateKairosOwnerModel: vi.fn(async (_u: string, mutate: (m: unknown) => { state: unknown; result: unknown }) => {
    const { state, result } = mutate(h.model)
    if (state) h.model = state
    return result
  }),
}))
vi.mock('@/lib/data/memories', () => ({ captureMemory: h.captureMemory, markKairosSpeaksReplied: h.markKairosSpeaksReplied }))
vi.mock('@/lib/kairos/today', () => ({ recordToday: h.recordToday }))
vi.mock('@/lib/kairos/telegram', () => ({ answerCallbackQuery: h.answerCallbackQuery, editMessageText: h.editMessageText }))

import type { KairosOwnerModel, OwnerItem } from '@/lib/data/validators/kairos-owner-model'
import { ownerModelLane } from '@/lib/kairos/moment/lanes/owner-model'
import { parseOwnerCommands, routeOwnerModelCommands } from '../telegram-commands'
import { emptyOwnerModel } from '../status'

const NOW = new Date('2026-10-04T12:00:00.000Z')
const OPERATOR_CHAT = '12345'

function item(seq: number, kind: OwnerItem['kind'], text: string): OwnerItem {
  return {
    id: `i${seq}`, seq, kind, text, domain: 'general', status: 'held',
    firstSeenAt: '2026-09-30T08:00:00.000Z', lastConfirmedAt: '2026-09-30T08:00:00.000Z',
    ...(kind === 'state' ? { expiresAt: '2026-10-10T08:00:00.000Z' } : {}),
    supportDays: [], confirmations: [],
  }
}

const current = () => h.model as KairosOwnerModel

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_OWNER_MODEL = '1'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = OPERATOR_CHAT
  h.model = {
    ...emptyOwnerModel(),
    nextSeq: 3,
    items: [item(1, 'state', 'stressed about the launch'), item(2, 'trait', 'values directness')],
    cards: [{ isoWeek: '2026-W41', at: NOW.toISOString(), status: 'sent', memoryId: 'mem-1', seqs: [1, 2] }],
  }
})

afterEach(() => {
  delete process.env.KAIROS_OWNER_MODEL
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
})

describe('parseOwnerCommands', () => {
  it('parses words and free text; any non-command line makes it chat', () => {
    expect(parseOwnerCommands('C1 still\nc2 wrong.\nC3: it is the investors really')).toEqual([
      { seq: 1, action: 'still' },
      { seq: 2, action: 'wrong' },
      { seq: 3, action: 'text', text: 'it is the investors really' },
    ])
    expect(parseOwnerCommands('C1 not true')).toEqual([{ seq: 1, action: 'wrong' }])
    expect(parseOwnerCommands('C1 done')).toEqual([{ seq: 1, action: 'over' }])
    expect(parseOwnerCommands('C1 still\nand also how are you?')).toBeNull()
    expect(parseOwnerCommands('Could you help me')).toBeNull()
    expect(parseOwnerCommands('')).toBeNull()
  })
})

describe('routeOwnerModelCommands', () => {
  it('is never a command unless KAIROS_OWNER_MODEL=1', async () => {
    for (const mode of ['0', 'observe']) {
      process.env.KAIROS_OWNER_MODEL = mode
      expect(await routeOwnerModelCommands('u', 'C1 still', vi.fn(), NOW)).toBe(false)
    }
  })

  it('an unknown C number falls through to chat', async () => {
    const send = vi.fn()
    expect(await routeOwnerModelCommands('u', 'C9 still', send, NOW)).toBe(false)
    expect(await routeOwnerModelCommands('u', 'C1 still\nC9 over', send, NOW)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('acks in one line, logs today, and writes no reflection for a word command', async () => {
    const send = vi.fn()
    expect(await routeOwnerModelCommands('u', 'C1 over\nC2 still', send, NOW, 500)).toBe(true)
    expect(send).toHaveBeenCalledWith('C1 over ✓ · C2 kept ✓')
    expect(current().items.map((i) => i.status)).toEqual(['ended', 'held'])
    expect(h.recordToday).toHaveBeenCalledTimes(2)
    expect(h.recordToday.mock.calls[0][1]).toMatchObject({ channel: 'telegram', type: 'decided' })
    expect(h.recordToday.mock.calls[0][2]).toEqual({ kind: 'operator', via: 'telegram:owner-card' })
    expect(h.captureMemory).not.toHaveBeenCalled()
  })

  it('free text rewrites the item in his words and writes one operator reflection', async () => {
    const send = vi.fn()
    await routeOwnerModelCommands('u', 'C1: honestly it is the investors, not the launch', send, NOW, 501)
    expect(current().items[0]).toMatchObject({ text: 'honestly it is the investors, not the launch', ownerText: 'honestly it is the investors, not the launch', lastConfirmedAt: NOW.toISOString() })
    expect(h.captureMemory).toHaveBeenCalledTimes(1)
    const [uid, input, opts] = h.captureMemory.mock.calls[0]
    expect(uid).toBe('u')
    expect(input).toMatchObject({ type: 'reflection', source: 'manual', bodyMd: 'honestly it is the investors, not the launch' })
    expect(input.sourceMetadata.externalId).toMatch(/^owner-card:2026-W40:1:/)
    expect(opts).toEqual({ origin: { kind: 'operator', via: 'telegram:owner-card' } })
    expect(send).toHaveBeenCalledWith('C1 updated in your words ✓')
  })
})

describe('card buttons (om1:*)', () => {
  const ctx = (data: string, fromId: string | null = OPERATOR_CHAT) => ({
    userId: 'u', callbackId: 'cbq', data, fromId, chatId: Number(OPERATOR_CHAT), messageId: 42, originalText: 'Card text', now: NOW,
  })

  it('answers, records, and edits the card without that row (Dismiss kept)', async () => {
    expect(await ownerModelLane.telegramCallback!(ctx('om1:x:1'))).toBe(true)
    expect(h.answerCallbackQuery).toHaveBeenCalledWith('cbq', 'C1 over ✓')
    expect(current().items[0]!.status).toBe('ended')
    expect(h.markKairosSpeaksReplied).toHaveBeenCalledWith('u', NOW)
    expect(h.editMessageText).toHaveBeenCalledWith(Number(OPERATOR_CHAT), 42, 'Card text\n\n— C1 over ✓', {
      inlineKeyboard: [
        [{ text: 'C2 yes', callback_data: 'om1:k:2' }, { text: 'C2 wrong', callback_data: 'om1:x:2' }],
        [{ text: 'Dismiss', callback_data: 'dismiss:mem-1' }],
      ],
    })
    expect(h.captureMemory).not.toHaveBeenCalled()
  })

  it('x on a trait is wrong (vetoed); k keeps', async () => {
    await ownerModelLane.telegramCallback!(ctx('om1:x:2'))
    expect(current().items[1]).toMatchObject({ status: 'retired', retiredReason: 'owner_wrong' })
    expect(current().vetoes).toHaveLength(1)
    await ownerModelLane.telegramCallback!(ctx('om1:k:1'))
    expect(h.answerCallbackQuery).toHaveBeenLastCalledWith('cbq', 'C1 kept to 14/10 ✓')
  })

  it('refuses a tap from someone else and answers a gone item without editing', async () => {
    expect(await ownerModelLane.telegramCallback!(ctx('om1:k:1', '999'))).toBe(true)
    expect(h.answerCallbackQuery).toHaveBeenCalledWith('cbq', 'Not allowed')
    expect(await ownerModelLane.telegramCallback!(ctx('om1:k:9'))).toBe(true)
    expect(h.answerCallbackQuery).toHaveBeenLastCalledWith('cbq', 'No longer open')
    expect(h.editMessageText).not.toHaveBeenCalled()
  })

  it('off / observe / other data: not handled', async () => {
    expect(await ownerModelLane.telegramCallback!(ctx('dismiss:abc'))).toBe(false)
    process.env.KAIROS_OWNER_MODEL = 'observe'
    expect(await ownerModelLane.telegramCallback!(ctx('om1:k:1'))).toBe(false)
    expect(h.answerCallbackQuery).not.toHaveBeenCalled()
  })
})
