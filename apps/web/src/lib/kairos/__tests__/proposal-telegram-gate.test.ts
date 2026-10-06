import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Goal proposals through the Kairos gate: on holds them until a natural break
// and the release sends them with their buttons; observe logs and sends; off
// is the old direct send. Real gate lane; data layer and Telegram stubbed.

const h = vi.hoisted(() => ({
  setProposalTelegram: vi.fn(),
  listTodayEntries: vi.fn(),
  findLatestOwnerCardClose: vi.fn(),
  readKairosGate: vi.fn(),
  appendKairosGateLog: vi.fn(),
  mutateKairosGate: vi.fn(),
  listHeldSpeaks: vi.fn(),
  claimHeldSpeak: vi.fn(),
  captureMemory: vi.fn(),
  findGoal: vi.fn(),
  fanOutSpeak: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/proposal-decision', () => ({ setProposalTelegram: h.setProposalTelegram }))
vi.mock('../proposal-decision', () => ({}))
vi.mock('@/lib/data/kairos-today', () => ({
  listTodayEntries: h.listTodayEntries,
  toKairosTodayView: (row: { createdAt: Date; payload: Record<string, unknown> }) => ({ at: row.createdAt.toISOString(), relayed: false, ...row.payload }),
}))
vi.mock('@/lib/data/kairos-gate', () => ({
  findLatestOwnerCardClose: h.findLatestOwnerCardClose,
  readKairosGate: h.readKairosGate,
  appendKairosGateLog: h.appendKairosGateLog,
  mutateKairosGate: h.mutateKairosGate,
  listHeldSpeaks: h.listHeldSpeaks,
  claimHeldSpeak: h.claimHeldSpeak,
}))
vi.mock('@/lib/data/memories', () => ({ captureMemory: h.captureMemory }))
vi.mock('@/lib/data/goals', () => ({ findGoal: h.findGoal }))
vi.mock('@/lib/kairos/speak', () => ({ fanOutSpeak: h.fanOutSpeak }))

import { emptyGateState } from '../moment/gate/receptivity'
import { releaseHeldSpeaks } from '../moment/gate/release'
import { announceGoalProposal } from '../proposal-telegram'
import { GOAL_PROPOSAL_HOLD_PREFIX } from '../proposal-telegram-gate'
import { proposalKeyboard } from '../telegram'

const USER = 'operator-1'
const CHAT = '12345'
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-04T02:30:00.000Z')
const chatting = [{ createdAt: new Date(NOW.getTime() - 2 * 60_000), payload: { channel: 'web', type: 'said', speaker: 'owner' } }]

const goal = (over: Record<string, unknown> = {}) => ({
  id: GOAL_ID,
  title: 'Board drift',
  meta: {
    state: 'proposed', question: 'Why do boards drift?', why: 'It keeps happening.',
    successCheck: { type: 'owner_confirm', text: 'A cause named' }, dueInDays: 5,
    expiresAt: '2026-10-07T02:30:00.000Z', telegram: null, ...over,
  },
}) as never

let fetchMock: ReturnType<typeof vi.fn>
const sends = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock = vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 700 } }) }))
  vi.stubGlobal('fetch', fetchMock)
  h.listTodayEntries.mockResolvedValue([])
  h.findLatestOwnerCardClose.mockResolvedValue(null)
  h.readKairosGate.mockResolvedValue(emptyGateState())
  h.appendKairosGateLog.mockResolvedValue(undefined)
  h.mutateKairosGate.mockResolvedValue(null)
  h.captureMemory.mockResolvedValue({ memory: { id: 'held-1' }, created: true })
  process.env.TELEGRAM_BOT_TOKEN = 'bot'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = CHAT
  process.env.KAIROS_OPERATOR_USER_ID = USER
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OPERATOR_CHAT_ID', 'KAIROS_OPERATOR_USER_ID', 'KAIROS_GATE']) delete process.env[k]
})

describe('gate on', () => {
  beforeEach(() => { process.env.KAIROS_GATE = '1' })

  it('holds the proposal mid-chat instead of sending it', async () => {
    h.listTodayEntries.mockResolvedValue(chatting)
    expect(await announceGoalProposal(USER, goal(), NOW)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.setProposalTelegram).not.toHaveBeenCalled()
    expect(h.captureMemory).toHaveBeenCalledOnce()
    const [user, row] = h.captureMemory.mock.calls[0]
    expect(user).toBe(USER)
    expect(row).toMatchObject({
      title: 'Goal proposal: Board drift',
      type: 'inbound',
      source: 'system',
      sourceMetadata: {
        kairosSpeak: true, status: 'held', kind: 'notify', urgency: 'normal', proposalId: GOAL_ID,
        externalId: `${GOAL_PROPOSAL_HOLD_PREFIX}${GOAL_ID}`,
        gate: { heldAt: NOW.toISOString(), until: '2026-10-04T04:30:00.000Z', reason: 'chat_live' },
      },
    })
    expect(h.appendKairosGateLog).toHaveBeenCalledWith(USER, [expect.objectContaining({ mode: 'on', decision: 'hold', reason: 'chat_live' })])
  })

  it('sends at once at a natural break and attaches the goal to the logged decision', async () => {
    expect(await announceGoalProposal(USER, goal(), NOW)).toBe(true)
    expect(sends()[0].reply_markup.inline_keyboard).toEqual(proposalKeyboard(GOAL_ID))
    expect(h.captureMemory).not.toHaveBeenCalled()
    expect(h.setProposalTelegram).toHaveBeenCalledWith(USER, GOAL_ID, { chatId: CHAT, messageId: 700 }, NOW)
    expect(h.mutateKairosGate).toHaveBeenCalledOnce()
  })

  it('a failing gate never swallows the proposal: it goes out now', async () => {
    h.listTodayEntries.mockRejectedValue(new Error('db down'))
    expect(await announceGoalProposal(USER, goal(), NOW)).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(h.captureMemory).not.toHaveBeenCalled()
  })

  it('release sends the held proposal with its Approve / Veto buttons', async () => {
    const held = { id: 'held-1', title: 'Goal proposal: Board drift', bodyMd: 'b', createdAt: NOW, sourceMetadata: { kairosSpeak: true, status: 'held', kind: 'notify', proposalId: GOAL_ID, gate: { until: '2026-10-04T02:00:00.000Z' } } }
    h.listHeldSpeaks.mockResolvedValue([held])
    h.claimHeldSpeak.mockResolvedValue({ ...held, sourceMetadata: { ...held.sourceMetadata, status: 'pending' } })
    h.findGoal.mockResolvedValue(goal())
    const out = await releaseHeldSpeaks(USER, NOW, 'tick')
    expect(out?.released).toEqual([{ id: 'held-1', reason: 'deadline', telegram: true }])
    expect(h.fanOutSpeak).not.toHaveBeenCalled()
    const [send] = sends()
    expect(send.text).toContain('Goal proposal: Board drift')
    expect(send.reply_markup.inline_keyboard).toEqual(proposalKeyboard(GOAL_ID))
    expect(h.setProposalTelegram).toHaveBeenCalledWith(USER, GOAL_ID, { chatId: CHAT, messageId: 700 }, NOW)
  })

  it.each([
    ['already decided', { state: 'vetoed' }],
    ['expired', { expiresAt: '2026-10-04T02:00:00.000Z' }],
    ['already announced', { telegram: { chatId: CHAT, messageId: 1 } }],
  ])('release skips a proposal that is %s', async (_label, over) => {
    const held = { id: 'held-1', title: 't', bodyMd: 'b', createdAt: NOW, sourceMetadata: { kairosSpeak: true, status: 'held', proposalId: GOAL_ID, gate: { until: '2026-10-04T02:00:00.000Z' } } }
    h.listHeldSpeaks.mockResolvedValue([held])
    h.claimHeldSpeak.mockResolvedValue(held)
    h.findGoal.mockResolvedValue(goal(over))
    const out = await releaseHeldSpeaks(USER, NOW, 'tick')
    expect(out?.released).toEqual([{ id: 'held-1', reason: 'deadline', telegram: false }])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.fanOutSpeak).not.toHaveBeenCalled()
  })
})

describe('gate observe', () => {
  beforeEach(() => { process.env.KAIROS_GATE = 'observe' })

  it('logs the would-be hold, still sends now with buttons, attaches the goal id', async () => {
    h.listTodayEntries.mockResolvedValue(chatting)
    expect(await announceGoalProposal(USER, goal(), NOW)).toBe(true)
    expect(sends()[0].reply_markup.inline_keyboard).toEqual(proposalKeyboard(GOAL_ID))
    expect(h.appendKairosGateLog).toHaveBeenCalledWith(USER, [expect.objectContaining({ mode: 'observe', decision: 'hold', reason: 'chat_live', memoryId: null })])
    expect(h.mutateKairosGate).toHaveBeenCalledOnce()
    expect(h.captureMemory).not.toHaveBeenCalled()
  })
})

describe('gate off', () => {
  it('sends directly and never touches the gate', async () => {
    h.listTodayEntries.mockResolvedValue(chatting)
    expect(await announceGoalProposal(USER, goal(), NOW)).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(h.setProposalTelegram).toHaveBeenCalledWith(USER, GOAL_ID, { chatId: CHAT, messageId: 700 }, NOW)
    for (const fn of [h.listTodayEntries, h.appendKairosGateLog, h.mutateKairosGate, h.captureMemory]) expect(fn).not.toHaveBeenCalled()
  })

  it('a non-operator proposal is still never sent or gated', async () => {
    process.env.KAIROS_GATE = '1'
    expect(await announceGoalProposal('someone-else', goal(), NOW)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.listTodayEntries).not.toHaveBeenCalled()
  })
})
