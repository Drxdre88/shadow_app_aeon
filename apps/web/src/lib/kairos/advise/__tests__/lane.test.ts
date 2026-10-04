import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Lane D through the real moment seam (other lanes stubbed empty): flags off
// = byte-identical prompt / reply / daily; flags on = advice lines, a trust
// footer at most once per area per thread per London day, Monday tail line.

vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/owner-model', () => ({ ownerModelLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/gate', () => ({ gateLane: {} }))
vi.mock('@/lib/kairos/moment/lanes/chapters', () => ({ chaptersLane: {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/kairos/stage', () => ({ loadStageBlock: vi.fn(async () => ({ block: '' })) }))
vi.mock('@/lib/data/kairos-chat', () => ({ getChatThread: vi.fn() }))
vi.mock('@/lib/data/kairos-trust', () => ({ readKairosTrust: vi.fn() }))

import { getChatThread } from '@/lib/data/kairos-chat'
import { readKairosTrust } from '@/lib/data/kairos-trust'
import { buildChatMessages, type BuildChatPromptInput } from '@/lib/kairos/chat-prompt'
import { guardChatReply } from '@/lib/kairos/chat-turn-reply'
import { finishChatReply, loadMomentChatOptions, stripMomentFooters } from '@/lib/kairos/moment/chat'
import { gatherMomentDaily } from '@/lib/kairos/moment'
import { scoreOf } from '@/lib/kairos/trust/compute'
import type { KairosTrustView, TrustArea } from '@/lib/kairos/trust/types'
import { OFFER_QUESTION } from '../classify'

const MONDAY = new Date('2026-10-05T05:00:00.000Z')
const PLAN = "I'm planning to move the launch to Friday so the team gets a weekend off"
const ASK = 'Should I move the AEON launch to Friday?'
const FLAGS = ['KAIROS_TRUST', 'KAIROS_ASK_FIRST', 'KAIROS_COLD_READ'] as const
const BASE: BuildChatPromptInput = { dominion: null, history: [{ role: 'user', content: 'earlier' }], userMessage: PLAN, surface: 'telegram' }
const ctx = (userBody: string) => ({ threadId: 't1', dominionId: null, userBody, userSeq: 5, surface: 'telegram' as const, history: [] })
const meta = (userBody: string) => ({ userSeq: 5, userBody, channel: 'telegram' as const, finishReason: 'stop' })

const AREA: TrustArea = {
  key: 'dom-a', kind: 'dominion', label: 'AEON', level: 'lean', statement: 'Lean on me here (9 settled, 90 days).', scored: scoreOf(8, 9),
  calls: null, wentAhead: { n: 0, ownerRight: 0, kairosRight: 0 }, goals: { taken: 0, landed: 0, missed: 0, vetoed: 0 },
  promises: { kept: 0, missed: 0 }, ideas: { accepted: 0, dismissed: 0 }, corrections7d: 0,
}
const VIEW: KairosTrustView = { windowDays: 90, minN: 5, areas: [AREA], corrections7d: 0, mode: { trust: 'on', askFirst: 'on' }, generatedAt: '', missing: [] }
const FOOTER = '⚖️ On AEON: Lean on me here (9 settled, 90 days).'

function thread(messages: Array<{ seq: number; role: 'user' | 'assistant'; content: string; createdAt?: Date }>) {
  return { thread: { dominionId: null }, messages: messages.map((m) => ({ createdAt: new Date(), ...m })) } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const f of FLAGS) delete process.env[f]
  vi.mocked(getChatThread).mockResolvedValue(thread([]))
  vi.mocked(readKairosTrust).mockResolvedValue(VIEW)
})
afterEach(() => { for (const f of FLAGS) delete process.env[f] })

describe('flags off: byte-identical', () => {
  it('chat system prompt is the baseline', async () => {
    for (const body of [PLAN, ASK, 'ugh']) {
      const opts = await loadMomentChatOptions('u', ctx(body))
      expect(opts).toEqual({})
      expect(buildChatMessages({ ...BASE, userMessage: body, ...opts })[0].content).toBe(buildChatMessages({ ...BASE, userMessage: body })[0].content)
    }
  })

  it('finishChatReply is exactly guardChatReply and reads nothing', async () => {
    const raw = 'My take: ship it Friday.'
    expect(await finishChatReply('u', 't1', raw, meta(ASK))).toBe(guardChatReply(raw, 'stop'))
    expect(getChatThread).not.toHaveBeenCalled()
    expect(readKairosTrust).not.toHaveBeenCalled()
  })

  it('daily tail is unchanged (no moment keys) and reads nothing', async () => {
    expect(await gatherMomentDaily('u', MONDAY)).toBeNull()
    expect(readKairosTrust).not.toHaveBeenCalled()
  })
})

describe('KAIROS_ASK_FIRST', () => {
  it('observe classifies and logs only', async () => {
    process.env.KAIROS_ASK_FIRST = 'observe'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(await loadMomentChatOptions('u', ctx(PLAN))).toEqual({})
    expect(info).toHaveBeenCalledWith('[kairos:advise] observe', expect.objectContaining({ mode: 'offer', reason: 'plan' }))
    info.mockRestore()
  })

  it('on: plan → offer lines + brief; explicit ask skips the offer; never any trust text', async () => {
    process.env.KAIROS_ASK_FIRST = '1'
    process.env.KAIROS_TRUST = '1'
    const offer = await loadMomentChatOptions('u', ctx(PLAN))
    expect(offer.briefReply).toBe(true)
    expect(offer.momentStyleLines?.join('\n')).toContain(OFFER_QUESTION)
    const advise = await loadMomentChatOptions('u', ctx(ASK))
    expect(advise.momentStyleLines?.join('\n')).toContain("'My take:'")
    expect(advise.briefReply).toBeUndefined()
    const system = buildChatMessages({ ...BASE, userMessage: ASK, ...advise })[0].content
    expect(system).not.toContain('⚖️')
    expect(system).not.toMatch(/second opinion|lean on me|settled/i)
    expect(readKairosTrust).not.toHaveBeenCalled()
  })

  it('cold read on: offer suppresses the stance after the cold-read lines', async () => {
    process.env.KAIROS_ASK_FIRST = '1'
    process.env.KAIROS_COLD_READ = 'audit'
    const opts = await loadMomentChatOptions('u', ctx(PLAN))
    const system = buildChatMessages({ ...BASE, ...opts })[0].content
    expect(system.indexOf('No `<stance>` line on this turn.')).toBeGreaterThan(system.indexOf('<stance>endorse'))
  })
})

describe('KAIROS_TRUST footer', () => {
  it('advise turn in a resolved, known area gets one footer; history strips it', async () => {
    process.env.KAIROS_TRUST = '1'
    const out = await finishChatReply('u', 't1', 'My take: ship it.', meta(ASK))
    expect(out).toBe(`My take: ship it.\n\n${FOOTER}`)
    expect(stripMomentFooters(out)).toBe('My take: ship it.')
  })

  it('not on a non-advice turn, an unresolved or unknown area, or twice the same London day', async () => {
    process.env.KAIROS_TRUST = '1'
    expect(await finishChatReply('u', 't1', 'Nice.', meta('Shipped it today'))).toBe('Nice.')
    expect(await finishChatReply('u', 't1', 'Hm.', meta('Should I go for a walk?'))).toBe('Hm.')
    vi.mocked(readKairosTrust).mockResolvedValueOnce({ ...VIEW, areas: [{ ...AREA, level: 'unknown' }] })
    expect(await finishChatReply('u', 't1', 'Hm.', meta(ASK))).toBe('Hm.')
    vi.mocked(getChatThread).mockResolvedValue(thread([{ seq: 2, role: 'assistant', content: `Earlier.\n\n${FOOTER}` }]))
    expect(await finishChatReply('u', 't1', 'Again.', meta(ASK))).toBe('Again.')
    vi.mocked(getChatThread).mockResolvedValue(thread([{ seq: 2, role: 'assistant', content: `Earlier.\n\n${FOOTER}`, createdAt: new Date(Date.now() - 3 * 86_400_000) }]))
    expect(await finishChatReply('u', 't1', 'Again.', meta(ASK))).toBe(`Again.\n\n${FOOTER}`)
  })

  it('observe logs the footer but returns the reply unchanged', async () => {
    process.env.KAIROS_TRUST = 'observe'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(await finishChatReply('u', 't1', 'My take: ship it.', meta(ASK))).toBe('My take: ship it.')
    expect(info).toHaveBeenCalledWith('[kairos:trust] observe footer', expect.objectContaining({ footer: FOOTER }))
    info.mockRestore()
  })
})

describe('KAIROS_TRUST Monday tail', () => {
  it('Monday only, as a tail line', async () => {
    process.env.KAIROS_TRUST = '1'
    expect(await gatherMomentDaily('u', MONDAY)).toEqual({ tail: ['⚖️ How far to trust me: AEON: lean on me (8/9)'] })
    expect(await gatherMomentDaily('u', new Date('2026-10-06T05:00:00.000Z'))).toBeNull()
  })
})
