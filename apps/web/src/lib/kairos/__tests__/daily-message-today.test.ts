import { beforeEach, describe, expect, it, vi } from 'vitest'

// Daily message × one mind (spec_one_mind): a code-built "yesterday across
// channels" input for the model, plus two code-built tail lines (verdicts,
// Horae) after the promise line that the model never sees — and the
// reserved-length trim still keeps the numbered Q block and every tail line.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn(async () => []) }))
vi.mock('@/lib/ai/route-task', () => ({ getProviderForTask: vi.fn() }))
vi.mock('../speak', () => ({ deliverKairosSpeak: vi.fn() }))
vi.mock('../cron-trace', () => ({ writeCronFailureTrace: vi.fn(), writeCronSuccessTrace: vi.fn() }))
vi.mock('../daily-message-inputs', () => ({ gatherDailyMessageInputs: vi.fn() }))
vi.mock('../conscience-context', () => ({ loadConscienceBlock: vi.fn(async () => '') }))
vi.mock('../promises/check', () => ({ PROMISE_CHECK_CRON: 'promise-check', verifyOpenPromises: vi.fn() }))

import { getProviderForTask } from '@/lib/ai/route-task'
import type { TodayEntryView } from '@/lib/data/kairos-today'
import { gatherDailyMessageInputs } from '../daily-message-inputs'
import { composeDailyMessage } from '../daily-message'
import { DAILY_MESSAGE_TOTAL_MAX_CHARS, buildDailyMessageUserPrompt, type DailyMessageInputs } from '../daily-message-prompt'
import { summariseTodayForDaily, todayPromptLines } from '../daily-message-today'
import { TAIL_LINE_MAX_CHARS, buildHoraeLine, buildVerdictLine, pickAgenda, pickVerdicts } from '../daily-message-tail'

const NOW = new Date('2026-10-01T05:00:00.000Z') // 06:00 London (BST)
const FROM = new Date('2026-09-29T23:00:00.000Z') // 30/09 00:00 London
const TO = new Date('2026-09-30T23:00:00.000Z') // 01/10 00:00 London

const entry = (over: Partial<TodayEntryView>): TodayEntryView =>
  ({ at: '2026-09-30T10:00:00.000Z', channel: 'telegram', type: 'said', speaker: 'owner', relayed: false, text: 'x', ...over })

const BASE: DailyMessageInputs = {
  date: '2026-10-01',
  isMonday: false,
  areas: [{ dominion: 'AEON', headline: 'Ship the board fix.' }],
  aether: null,
  boardDay: null,
  promotions: null,
  newBeliefs: null,
  drift: null,
  openAsks: null,
  synthesis: null,
  mindCompare: null,
  failed: [],
}

describe('summariseTodayForDaily', () => {
  it('keeps the previous London day: owner words, decisions and a coalesced MCP-use summary', () => {
    const digest = summariseTodayForDaily([
      entry({ at: '2026-09-29T22:59:00.000Z', text: 'before the window' }),
      entry({ text: 'Fridays are for writing.' }),
      entry({ channel: 'web', speaker: 'kairos', type: 'replied', text: 'Noted.' }),
      entry({ channel: 'triad', speaker: 'agent', type: 'said', relayed: true, text: 'relayed owner words' }),
      entry({ channel: 'inbox', type: 'decided', text: 'Approved: Why do boards drift?' }),
      entry({ channel: 'mcp', speaker: 'agent', type: 'used', tool: 'search_memories', count: 50, text: '' }),
      entry({ channel: 'mcp', speaker: 'agent', type: 'used', tool: 'prepare_context', text: '' }),
      entry({ channel: 'mcp', speaker: 'agent', type: 'used', tool: 'search_memories', count: 2, text: '' }),
      entry({ at: '2026-09-30T23:00:00.000Z', text: 'after the window' }),
    ], FROM, TO)

    expect(digest).toEqual({
      ownerSaid: [{ channel: 'telegram', text: 'Fridays are for writing.' }],
      decisions: [{ channel: 'inbox', text: 'Approved: Why do boards drift?' }],
      mcpUse: 'search_memories ×52, prepare_context ×1',
    })
    expect(todayPromptLines(digest)).toEqual([
      'Owner said (telegram): "Fridays are for writing."',
      'Decided (inbox): Approved: Why do boards drift?',
      'Claude used me over MCP: search_memories ×52, prepare_context ×1',
    ])
  })

  it('is null for a quiet day', () => {
    expect(summariseTodayForDaily([entry({ speaker: 'kairos', type: 'spoke' })], FROM, TO)).toBeNull()
  })
})

describe('model prompt', () => {
  it('includes the today block but never the verdict or Horae data', () => {
    const prompt = buildDailyMessageUserPrompt({
      ...BASE,
      today: { ownerSaid: [{ channel: 'web', text: 'Fridays are for writing.' }], decisions: [], mcpUse: null },
      verdicts: [{ seq: 3, claim: 'The Aeon deploy ships by Friday.' }],
      agenda: [{ seq: 2, dueAt: '2026-10-08T08:00:00.000Z', what: 'Check the deploy landed' }],
    })
    expect(prompt).toContain('YESTERDAY ACROSS CHANNELS')
    expect(prompt).toContain('Owner said (web): "Fridays are for writing."')
    expect(prompt).not.toMatch(/R3|Aeon deploy ships|A2|Check the deploy landed/)
  })
})

describe('tail lines', () => {
  it('formats the verdict and Horae lines with their reply commands', () => {
    expect(buildVerdictLine([{ seq: 3, claim: 'The Aeon deploy ships by Friday.' }]))
      .toBe("Needs your verdict: R3 · The Aeon deploy ships by Friday. — reply 'R3 right' or 'R3 wrong'.")
    expect(buildHoraeLine([
      { seq: 2, dueAt: '2026-10-08T08:00:00.000Z', what: 'Check the deploy landed' },
      { seq: 4, dueAt: '2026-10-09T13:00:00.000Z', what: 'Ask how the review went' },
    ])).toBe("Horae: A2 Thu 08/10 — Check the deploy landed; A4 Fri 09/10 — Ask how the review went; reply 'cancel A2'.")
    expect(buildVerdictLine(null)).toBe('')
    expect(buildHoraeLine([])).toBe('')
  })

  it('stays under the line cap by shortening claims, then dropping items', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, claim: 'A long falsifiable claim about the board shipping on time this week.' }))
    const line = buildVerdictLine(many)
    expect(line.length).toBeLessThanOrEqual(TAIL_LINE_MAX_CHARS)
    expect(line).toMatch(/^Needs your verdict: R1/)
    expect(line).toContain("reply 'R1 right' or 'R1 wrong'")
  })

  it('picks owner-verdict predictions past due (and flagged ones) inside the 7-day window; Horae ≤3 open, soonest first', () => {
    const p = (seq: number, dueDate: string, over: Record<string, unknown> = {}) =>
      ({ seq, claim: `claim ${seq}`, dueDate, status: 'open', check: { kind: 'owner_verdict' }, ...over }) as never
    const verdicts = pickVerdicts([
      p(1, '2026-09-30'),
      p(2, '2026-10-01'),
      p(3, '2026-09-20'),
      p(4, '2026-10-05', { status: 'needs_verdict' }),
      p(5, '2026-09-29', { check: { kind: 'card_by' } }),
    ], NOW)
    expect(verdicts.map((v) => v.seq)).toEqual([1, 4])

    const a = (seq: number, dueAt: string, status = 'open') => ({ seq, dueAt, what: `w${seq}`, status }) as never
    expect(pickAgenda([a(5, '2026-10-09'), a(1, '2026-10-03'), a(2, '2026-10-02', 'fired'), a(3, '2026-10-04'), a(4, '2026-10-05')]).map((i) => i.seq))
      .toEqual([1, 3, 4])
  })
})

describe('composeDailyMessage — tail order and trim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProviderForTask).mockRejectedValue(new Error('no provider')) // → deterministic draft
  })

  const openAsks = Array.from({ length: 10 }, (_, i) => ({ seq: 10 + i, question: `Question ${i} ${'q'.repeat(150)}?`, askedAt: '2026-09-25T08:00:00.000Z' }))

  it('appends promise → verdict → Horae after the Q block', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({
      ...BASE,
      openAsks: openAsks.slice(0, 1),
      promises: { open: [{ seq: 7, outcome: 'Report back on drift', dueDate: '2026-10-01', status: 'open' }], closedSince: [] },
      verdicts: [{ seq: 3, claim: 'The Aeon deploy ships by Friday.' }],
      agenda: [{ seq: 2, dueAt: '2026-10-08T08:00:00.000Z', what: 'Check the deploy landed' }],
    })

    const { message } = await composeDailyMessage('u1', NOW)
    const q = message.indexOf('Open questions (1)')
    const promise = message.indexOf('Promises (1 open)')
    const verdict = message.indexOf('Needs your verdict: R3')
    const horae = message.indexOf('Horae: A2')
    expect(q).toBeGreaterThan(0)
    expect(promise).toBeGreaterThan(q)
    expect(verdict).toBeGreaterThan(promise)
    expect(horae).toBeGreaterThan(verdict)
    expect(message.endsWith("reply 'cancel A2'.")).toBe(true)
  })

  it('a full message still fits: the narrative trims first, the Q block and both tail lines survive', async () => {
    vi.mocked(gatherDailyMessageInputs).mockResolvedValue({
      ...BASE,
      areas: Array.from({ length: 4 }, (_, i) => ({ dominion: `Area ${i}`, headline: 'h'.repeat(140) })),
      openAsks,
      verdicts: Array.from({ length: 8 }, (_, i) => ({ seq: i + 1, claim: 'c'.repeat(120) })),
      agenda: [1, 2, 3].map((seq) => ({ seq, dueAt: '2026-10-08T08:00:00.000Z', what: 'w'.repeat(150) })),
    })

    const { message } = await composeDailyMessage('u1', NOW)
    expect(message.length).toBeLessThanOrEqual(DAILY_MESSAGE_TOTAL_MAX_CHARS)
    expect(message).toContain('Open questions (10)')
    for (const ask of openAsks) expect(message).toContain(`Q${ask.seq} ·`)
    expect(message).toContain('Needs your verdict: R1')
    expect(message).toContain("reply 'cancel A1'.")
  })
})
