import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MOMENT_LANES,
  gatherMomentDaily,
  hasMomentHook,
  runChatContext,
  runFinishReply,
  runOwnerDecisionHooks,
  runSpeakPolicies,
  runStripFooters,
  runSweepHooks,
  runTelegramCallback,
  runTelegramMessage,
  runTelegramText,
  type MomentLane,
  type MomentLaneName,
  type NamedMomentLane,
  type SpeakPolicyContext,
} from '../index'

const named = (name: MomentLaneName, lane: MomentLane): NamedMomentLane => ({ name, lane })
const boom = () => { throw new Error('boom') }
const NOW = new Date('2026-10-04T10:00:00Z')
const policyCtx = {
  userId: 'u', gate: false, awaitingReply: false, replyRate7d: 0, now: NOW,
  input: { title: 't', message: 'm', kind: 'notify', urgency: 'normal', force: false, opsAlert: false, digest: false },
} as SpeakPolicyContext
const chatCtx = { userId: 'u', threadId: 't', dominionId: null, userBody: 'hi', userSeq: 1, surface: 'telegram' as const, history: [] }
const replyCtx = { userId: 'u', threadId: 't', userSeq: 1, userBody: 'hi', channel: 'web' as const }

const HOOKS: Array<keyof MomentLane> = [
  'speakPolicy', 'speakDelivered', 'sweep', 'ownerTurn', 'reply', 'chatContext', 'finishReply', 'stripFooter',
  'daily', 'dailyDelivered', 'telegramText', 'telegramCallback', 'telegramMessage', 'ownerDecision',
]

afterEach(() => vi.restoreAllMocks())

describe('moment registry', () => {
  it('runs in fixed order: rapport, advise-trust, owner-model, gate, chapters', () => {
    expect(MOMENT_LANES.map((l) => l.name)).toEqual(['rapport', 'advise-trust', 'owner-model', 'gate', 'chapters'])
  })

})

describe('moment runners with empty lanes', () => {
  const empty = [named('rapport', {}), named('gate', {})]

  it('pass through: same string, null or false, no keys', async () => {
    const content = 'reply text'
    expect(await runSpeakPolicies(policyCtx, empty)).toBeNull()
    expect(await runSweepHooks('u', NOW, empty)).toBeNull()
    expect(await runChatContext(chatCtx, empty)).toEqual({})
    expect(await runFinishReply(content, replyCtx, empty)).toBe(content)
    expect(runStripFooters(content, empty)).toBe(content)
    expect(await gatherMomentDaily('u', NOW, empty)).toBeNull()
    expect(await runTelegramText({ userId: 'u', chatId: 1, body: 'x', message: {}, updateId: 1, send: vi.fn(), now: NOW }, empty)).toBe(false)
    expect(await runTelegramCallback({ userId: 'u', callbackId: 'c', data: 'om1:k:1', fromId: '1', chatId: 1, messageId: 2, originalText: '', now: NOW }, empty)).toBe(false)
    expect(await runTelegramMessage({ userId: 'u', chatId: 1, message: { sticker: {} }, updateId: 1, now: NOW }, empty)).toBe(false)
    await expect(runOwnerDecisionHooks({ userId: 'u', memoryId: 'm', verdict: 'dismiss', kairosSpeak: true, kind: null }, empty)).resolves.toBeUndefined()
  })

  it('a lane that returns nothing useful keeps the outputs empty', async () => {
    const silent = [named('rapport', { chatContext: () => null, daily: () => ({ openings: [], tail: ['  '] }), sweep: () => null })]
    expect(await runChatContext(chatCtx, silent)).toEqual({})
    expect(await gatherMomentDaily('u', NOW, silent)).toBeNull()
    expect(await runSweepHooks('u', NOW, silent)).toBeNull()
  })
})

describe('speak policies', () => {
  it('a block beats an earlier hold; the first valid hold wins otherwise', async () => {
    const until = '2026-10-04T12:00:00.000Z'
    expect(await runSpeakPolicies(policyCtx, [
      named('gate', { speakPolicy: () => ({ hold: { until, reason: 'busy' } }) }),
      named('rapport', { speakPolicy: () => ({ block: { status: 429, reason: 'backing_off' } }) }),
    ])).toEqual({ block: { status: 429, reason: 'backing_off' } })
    expect(await runSpeakPolicies(policyCtx, [
      named('gate', { speakPolicy: () => ({ hold: { until, reason: 'busy' } }) }),
      named('chapters', { speakPolicy: () => ({ hold: { until: '2026-10-04T13:00:00Z', reason: 'later' } }) }),
    ])).toEqual({ hold: { until, reason: 'busy' } })
  })

  it('a throwing or malformed policy is logged and ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runSpeakPolicies(policyCtx, [
      named('rapport', { speakPolicy: boom }),
      named('gate', { speakPolicy: () => ({ hold: { until: 'not a date', reason: 'busy' } }) }),
    ])).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('chat contributions', () => {
  it('merges sections from every lane; a claim stops later style lines and brief', async () => {
    const out = await runChatContext(chatCtx, [
      named('rapport', { chatContext: () => ({ section: ' repair note ', styleLines: ['- Repair first.'], brief: true, claim: true }) }),
      named('advise-trust', { chatContext: () => ({ section: 'trust note', styleLines: ['- My take last.'] }) }),
    ])
    expect(out).toEqual({ momentSections: ['repair note', 'trust note'], momentStyleLines: ['- Repair first.'], briefReply: true })
  })

  it('without a claim every lane adds style lines in order', async () => {
    const out = await runChatContext(chatCtx, [
      named('rapport', { chatContext: () => ({ styleLines: ['- a'] }) }),
      named('owner-model', { chatContext: () => ({ styleLines: ['- b', ''] }) }),
    ])
    expect(out).toEqual({ momentStyleLines: ['- a', '- b'] })
  })

  it('a throwing finisher passes the content through; later finishers still run', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await runFinishReply('body', replyCtx, [
      named('rapport', { finishReply: boom }),
      named('advise-trust', { finishReply: (c) => `${c}\n\n⚖️ footer` }),
    ])
    expect(out).toBe('body\n\n⚖️ footer')
    expect(runStripFooters(out, [named('advise-trust', { stripFooter: (c) => c.replace(/\n\n⚖️[\s\S]*$/, '') })])).toBe('body')
  })
})

describe('sweep, daily and telegram', () => {
  it('sweep keys merge first-wins; a throwing lane adds nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await runSweepHooks('u', NOW, [
      named('owner-model', { sweep: boom }),
      named('gate', { sweep: () => ({ gate: { released: 1 } }) }),
      named('chapters', { sweep: () => ({ gate: 'shadowed', chapter: 'x' }) }),
    ])).toEqual({ gate: { released: 1 }, chapter: 'x' })
  })

  it('daily parts concatenate in lane order and omit empty arrays', async () => {
    expect(await gatherMomentDaily('u', NOW, [
      named('rapport', { daily: () => ({ openings: ['Sorry I pushed.'] }) }),
      named('advise-trust', { daily: () => ({ tail: ['⚖️ trust'] }) }),
    ])).toEqual({ openings: ['Sorry I pushed.'], tail: ['⚖️ trust'] })
  })

  it('the first lane that handles a Telegram update stops the chain', async () => {
    const later = vi.fn(() => true)
    const ctx = { userId: 'u', chatId: 1, body: 'C1 over', message: {}, updateId: 9, send: vi.fn(), now: NOW }
    expect(await runTelegramText(ctx, [named('rapport', { telegramText: () => false }), named('owner-model', { telegramText: () => true }), named('gate', { telegramText: later })])).toBe(true)
    expect(later).not.toHaveBeenCalled()
  })
})
