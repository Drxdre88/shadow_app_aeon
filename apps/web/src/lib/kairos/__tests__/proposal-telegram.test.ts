import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Telegram side of proposal decisions (Phase 2, Track C): the p1 keyboard,
// the button outcomes, and the free-text "why" after a "Veto + why".
// Telegram itself is the stubbed fetch; the decision function is mocked.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/proposal-decision', () => ({
  claimVetoReason: vi.fn(async () => true),
  findReasonByUpdateId: vi.fn(async () => false),
  listReasonPromptRows: vi.fn(async () => []),
  setProposalTelegram: vi.fn(async () => undefined),
  setReasonPrompt: vi.fn(async () => true),
}))
vi.mock('../proposal-decision', () => ({
  decideKairosProposal: vi.fn(),
  applyVetoReason: vi.fn(async () => undefined),
  verdictLabel: (v: 'approve' | 'veto') => (v === 'approve' ? 'Approved' : 'Vetoed'),
}))

import {
  claimVetoReason,
  findReasonByUpdateId,
  listReasonPromptRows,
  setProposalTelegram,
  setReasonPrompt,
  type ReasonPromptRow,
} from '@/lib/data/proposal-decision'
import { applyVetoReason, decideKairosProposal } from '../proposal-decision'
import { announceGoalProposal, handleProposalCallback, routeVetoReason } from '../proposal-telegram'
import { PROPOSAL_CALLBACK_RE, proposalCallbackData, proposalKeyboard } from '../telegram'

const USER = 'operator-1'
const CHAT = '12345'
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NOW = new Date('2026-10-02T09:00:00.000Z')

let fetchMock: ReturnType<typeof vi.fn>
let nextMessageId = 500

function calls() {
  return fetchMock.mock.calls.map(([url, init]) => ({ method: String(url).split('/').pop(), body: JSON.parse(init.body) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  nextMessageId = 500
  fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: nextMessageId++ } }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  process.env.TELEGRAM_BOT_TOKEN = 'bot'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = CHAT
  process.env.KAIROS_OPERATOR_USER_ID = USER
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
  delete process.env.KAIROS_OPERATOR_USER_ID
})

describe('p1 keyboard', () => {
  it('lays out [[Approve]], [[Veto], [Veto + why]] with p1:a|v|w:<uuid> ≤ 64 bytes', () => {
    const kb = proposalKeyboard(GOAL_ID)
    expect(kb.map((row) => row.map((b) => b.text))).toEqual([['Approve'], ['Veto', 'Veto + why']])
    const data = kb.flat().map((b) => b.callback_data!)
    expect(data).toEqual([`p1:a:${GOAL_ID}`, `p1:v:${GOAL_ID}`, `p1:w:${GOAL_ID}`])
    for (const d of data) {
      expect(new TextEncoder().encode(d).length).toBeLessThanOrEqual(64)
      expect(PROPOSAL_CALLBACK_RE.test(d)).toBe(true)
    }
  })

  it('refuses callback data over 64 bytes', () => {
    expect(() => proposalCallbackData('a', 'x'.repeat(80))).toThrow(/64 bytes/)
  })
})

describe('announceGoalProposal', () => {
  const goal = {
    id: GOAL_ID,
    title: 'Board drift',
    meta: {
      question: 'Why do boards drift?', why: 'It keeps happening.', successCheck: { type: 'owner_confirm', text: 'A cause named' },
      dueInDays: 5, expiresAt: '2026-10-05T09:00:00.000Z',
    },
  } as never

  it('sends the proposal with its buttons and stores where it landed', async () => {
    expect(await announceGoalProposal(USER, goal, NOW)).toBe(true)
    const [send] = calls()
    expect(send.method).toBe('sendMessage')
    expect(send.body.chat_id).toBe(CHAT)
    expect(send.body.text).toContain('Goal proposal: Board drift')
    expect(send.body.text).toContain('Expires 05/10, 10:00')
    expect(send.body.reply_markup.inline_keyboard).toEqual(proposalKeyboard(GOAL_ID))
    expect(setProposalTelegram).toHaveBeenCalledWith(USER, GOAL_ID, { chatId: CHAT, messageId: 500 }, NOW)
  })

  it('never sends another user\'s proposal to the operator chat', async () => {
    expect(await announceGoalProposal('someone-else', goal, NOW)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleProposalCallback outcomes', () => {
  const input = (action: 'a' | 'v' | 'w') => ({
    callbackId: 'cb-1', action, proposalId: GOAL_ID, chatId: Number(CHAT), messageId: 42, originalText: 'Goal proposal: Drift',
  })

  it('approve → toast, buttons stripped, "— Approved ✓"', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: true, verdict: 'approve', title: 'Drift', kind: 'goal', memoryId: GOAL_ID })
    await handleProposalCallback(USER, input('a'), NOW)
    expect(decideKairosProposal).toHaveBeenCalledWith(USER, GOAL_ID, { verdict: 'approve', wantsReason: false, via: 'telegram', now: NOW })
    expect(calls()).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: 'cb-1', text: 'Approved' } },
      { method: 'editMessageText', body: { chat_id: Number(CHAT), message_id: 42, text: 'Goal proposal: Drift\n\n— Approved ✓', reply_markup: { inline_keyboard: [] } } },
    ])
  })

  it('veto → "— Vetoed ✓", no reason prompt', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: true, verdict: 'veto', title: 'Drift', kind: 'goal', memoryId: GOAL_ID })
    await handleProposalCallback(USER, input('v'), NOW)
    expect(calls().map((c) => c.method)).toEqual(['answerCallbackQuery', 'editMessageText'])
    expect(calls()[1].body.text).toBe('Goal proposal: Drift\n\n— Vetoed ✓')
    expect(setReasonPrompt).not.toHaveBeenCalled()
  })

  it('veto + why → also a force-reply "why" prompt, remembered for routing', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: true, verdict: 'veto', title: 'Drift', kind: 'goal', memoryId: GOAL_ID })
    await handleProposalCallback(USER, input('w'), NOW)
    expect(decideKairosProposal).toHaveBeenCalledWith(USER, GOAL_ID, expect.objectContaining({ verdict: 'veto', wantsReason: true }))
    const prompt = calls()[2]
    expect(prompt).toMatchObject({
      method: 'sendMessage',
      body: { chat_id: Number(CHAT), text: "Why the veto on 'Drift'? Reply here, or 'no reason'.", reply_markup: { force_reply: true } },
    })
    expect(setReasonPrompt).toHaveBeenCalledWith(USER, GOAL_ID, { messageId: 502, at: NOW })
  })

  it('already decided → toast only (repeat tap does nothing)', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: false, reason: 'already_decided', decided: 'approve' })
    await handleProposalCallback(USER, input('v'), NOW)
    expect(calls()).toEqual([{ method: 'answerCallbackQuery', body: { callback_query_id: 'cb-1', text: 'Already decided: Approved' } }])
  })

  it('expired → "Expired — no action" and the buttons go', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: false, reason: 'expired' })
    await handleProposalCallback(USER, input('a'), NOW)
    expect(calls()[0].body.text).toBe('Expired — no action')
    expect(calls()[1]).toMatchObject({ method: 'editMessageText', body: { text: 'Goal proposal: Drift\n\n— Expired, no action', reply_markup: { inline_keyboard: [] } } })
  })

  it('cap reached → toast, nothing edited', async () => {
    vi.mocked(decideKairosProposal).mockResolvedValue({ ok: false, reason: 'cap_reached' })
    await handleProposalCallback(USER, input('a'), NOW)
    expect(calls()).toHaveLength(1)
    expect(calls()[0].body.text).toMatch(/already open/)
  })
})

describe('routeVetoReason', () => {
  const row = (over: Partial<ReasonPromptRow['decision']> = {}, id = GOAL_ID): ReasonPromptRow => ({
    id,
    title: 'Drift',
    kind: 'goal',
    decision: {
      verdict: 'veto', via: 'telegram', at: NOW.toISOString(), reason: null, awaitingReason: true,
      reasonPromptMessageId: 77, reasonPromptAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(), ...over,
    },
  })
  const msg = (text: string, replyTo: number | null = null, updateId: number | null = 900) => ({ text, replyToMessageId: replyTo, updateId })

  it('a reply to the prompt (≤24h) is the reason: claimed once, kept on the goal, acked', async () => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([row({ reasonPromptAt: new Date(NOW.getTime() - 20 * 3_600_000).toISOString() })])
    expect(await routeVetoReason(USER, CHAT, msg('too vague to act on', 77), NOW)).toBe(true)
    expect(listReasonPromptRows).toHaveBeenCalledWith(USER, new Date(NOW.getTime() - 24 * 3_600_000))
    expect(claimVetoReason).toHaveBeenCalledWith(USER, GOAL_ID, { reason: 'too vague to act on', declined: false, updateId: 900, now: NOW })
    expect(applyVetoReason).toHaveBeenCalledWith(USER, GOAL_ID, 'goal', 'too vague to act on', NOW)
    expect(calls()[0].body.text).toMatch(/^Noted/)
  })

  it('a plain message within 30 min of the newest prompt counts; after 30 min it is chat', async () => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([row()])
    expect(await routeVetoReason(USER, CHAT, msg('not now'), NOW)).toBe(true)

    vi.clearAllMocks()
    vi.mocked(listReasonPromptRows).mockResolvedValue([row({ reasonPromptAt: new Date(NOW.getTime() - 31 * 60_000).toISOString() })])
    expect(await routeVetoReason(USER, CHAT, msg('what is on today?'), NOW)).toBe(false)
    expect(claimVetoReason).not.toHaveBeenCalled()
  })

  it.each(['no reason', 'skip', 'None.'])('"%s" declines: closed with no reason, nothing written on the goal', async (text) => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([row()])
    expect(await routeVetoReason(USER, CHAT, msg(text, 77), NOW)).toBe(true)
    expect(claimVetoReason).toHaveBeenCalledWith(USER, GOAL_ID, expect.objectContaining({ reason: null, declined: true }))
    expect(applyVetoReason).not.toHaveBeenCalled()
    expect(calls()[0].body.text).toMatch(/no reason noted/)
  })

  it('a redelivered update is swallowed (durable dedup by update_id)', async () => {
    vi.mocked(findReasonByUpdateId).mockResolvedValueOnce(true)
    expect(await routeVetoReason(USER, CHAT, msg('too vague', 77, 900), NOW)).toBe(true)
    expect(findReasonByUpdateId).toHaveBeenCalledWith(USER, 900)
    expect(claimVetoReason).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('anything that looks like a Q answer is never a reason', async () => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([row()])
    expect(await routeVetoReason(USER, CHAT, msg('Q12: yes'), NOW)).toBe(false)
    expect(listReasonPromptRows).not.toHaveBeenCalled()
  })

  it('a reply to an already-answered prompt is not re-aimed at another proposal', async () => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([
      { ...row({ reasonPromptMessageId: 88 }), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      row({ awaitingReason: false, reasonPromptMessageId: 66 }),
    ])
    expect(await routeVetoReason(USER, CHAT, msg('late thought', 66), NOW)).toBe(false)
    expect(claimVetoReason).not.toHaveBeenCalled()
  })

  it('a lost claim (concurrent delivery) is handled silently', async () => {
    vi.mocked(listReasonPromptRows).mockResolvedValue([row()])
    vi.mocked(claimVetoReason).mockResolvedValueOnce(false)
    expect(await routeVetoReason(USER, CHAT, msg('too vague', 77), NOW)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
