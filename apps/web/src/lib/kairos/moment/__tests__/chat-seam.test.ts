import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Chat side of the moment seam: empty lanes leave the options, the system
// prompt (web + Telegram; the routine reuses it) and the reply untouched.

const lanes = vi.hoisted(() => ({ rapport: {} as Record<string, unknown>, adviseTrust: {} as Record<string, unknown> }))
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('@/lib/kairos/moment/lanes/advise-trust', () => ({ adviseTrustLane: lanes.adviseTrust }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/kairos/stage', () => ({ loadStageBlock: vi.fn() }))
vi.mock('@/lib/kairos/cold-read/flag', () => ({ coldReadEnabled: vi.fn() }))

import { loadStageBlock } from '@/lib/kairos/stage'
import { coldReadEnabled } from '@/lib/kairos/cold-read/flag'
import { guardChatReply } from '@/lib/kairos/chat-turn-reply'
import { COLD_READ_CHAT_LINES } from '@/lib/kairos/cold-read/stance'
import { TELEGRAM_CHAT_PERSONA, buildChatMessages, buildChatSystemPrompt, type BuildChatPromptInput } from '@/lib/kairos/chat-prompt'
import { finishChatReply, loadMomentChatOptions, stripMomentFooters } from '../chat'

const CTX = { threadId: 't', dominionId: null, userBody: 'ugh', userSeq: 3, surface: 'telegram' as const, history: [] }
const BASE: BuildChatPromptInput = {
  dominion: null,
  history: [{ role: 'user', content: 'earlier' }],
  userMessage: 'now',
  todaySection: 'TODAY BLOCK',
  conscienceSection: 'CONSCIENCE BLOCK',
  stageSection: 'STAGE BLOCK',
  coldRead: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadStageBlock).mockResolvedValue({ block: '' } as never)
  vi.mocked(coldReadEnabled).mockReturnValue(false)
})

afterEach(() => {
  for (const lane of Object.values(lanes)) for (const key of Object.keys(lane)) delete lane[key]
})

describe('loadMomentChatOptions', () => {
  it('with empty lanes equals the old stage + cold-read wiring', async () => {
    expect(await loadMomentChatOptions('u', CTX)).toEqual({})
    vi.mocked(loadStageBlock).mockResolvedValue({ block: 'STAGE' } as never)
    vi.mocked(coldReadEnabled).mockReturnValue(true)
    expect(await loadMomentChatOptions('u', CTX)).toEqual({ stageSection: 'STAGE', coldRead: true })
    expect(loadStageBlock).toHaveBeenCalledWith('u')
  })

  it('adds lane sections, style lines and brief', async () => {
    lanes.rapport.chatContext = () => ({ section: 'RAPPORT', styleLines: ['- one line'], brief: true, claim: true })
    lanes.adviseTrust.chatContext = () => ({ styleLines: ['- my take last'] })
    expect(await loadMomentChatOptions('u', CTX)).toEqual({ momentSections: ['RAPPORT'], momentStyleLines: ['- one line'], briefReply: true })
  })
})

describe('chat system prompt', () => {
  it('is byte-identical with absent or empty moment options (web and Telegram)', () => {
    for (const surface of ['app', 'telegram'] as const) {
      const before = buildChatMessages({ ...BASE, surface })
      const after = buildChatMessages({ ...BASE, surface, momentSections: [], momentStyleLines: [], briefReply: false })
      expect(after[0].content).toBe(before[0].content)
      expect(after).toEqual(before)
      expect(buildChatSystemPrompt(null, { surface, momentSections: ['  '] })).toBe(buildChatSystemPrompt(null, { surface }))
    }
  })

  it('renders moment sections after the conscience block and style lines after the cold-read lines', () => {
    const system = buildChatSystemPrompt(null, {
      ...BASE, surface: 'telegram', momentSections: ['MOMENT A', 'MOMENT B'], momentStyleLines: ['- MOMENT STYLE'],
    })
    expect(system).toContain('CONSCIENCE BLOCK\n\n---\n\nMOMENT A\n\nMOMENT B\n\n---\n\nStyle:')
    const lastColdRead = COLD_READ_CHAT_LINES[COLD_READ_CHAT_LINES.length - 1]
    expect(system).toContain(`${lastColdRead}\n- MOMENT STYLE`)
  })

  it('briefReply drops the Telegram persona lines on Telegram only', () => {
    const brief = buildChatSystemPrompt(null, { surface: 'telegram', briefReply: true })
    for (const line of TELEGRAM_CHAT_PERSONA) expect(brief).not.toContain(line)
    expect(brief).toContain('You are texting the operator on Telegram')
    expect(buildChatSystemPrompt(null, { surface: 'app', briefReply: true })).toBe(buildChatSystemPrompt(null, { surface: 'app' }))
  })
})

describe('finishChatReply / stripMomentFooters', () => {
  it('with empty lanes is exactly the cut-short guard', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const raw = 'A full sentence. And a cut'
    const meta = { userSeq: 1, userBody: 'x', channel: 'web' as const }
    expect(await finishChatReply('u', 't', raw, { ...meta, finishReason: 'length' })).toBe(guardChatReply(raw, 'length'))
    expect(await finishChatReply('u', 't', raw, { ...meta, finishReason: 'stop' })).toBe(raw)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
    expect(stripMomentFooters('reply\n\n⚖️ On delivery: x')).toBe('reply\n\n⚖️ On delivery: x')
  })

  it('runs lane finishers after the guard; a throwing finisher passes the content through', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lanes.rapport.finishReply = () => { throw new Error('boom') }
    lanes.adviseTrust.finishReply = (c: string) => `${c}\n\n⚖️ footer`
    lanes.adviseTrust.stripFooter = (c: string) => c.replace(/\n\n⚖️[\s\S]*$/, '')
    const out = await finishChatReply('u', 't', 'body', { userSeq: 1, userBody: 'x', channel: 'telegram' })
    expect(out).toBe('body\n\n⚖️ footer')
    expect(stripMomentFooters(out)).toBe('body')
  })
})
