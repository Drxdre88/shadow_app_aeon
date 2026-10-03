import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// prepare_context "Today across channels" (spec_one_mind): the shared data-layer
// block both MCP prepare_context and REST /memories/context prepend. Data-layer
// reader + pure renderer only; ≤15% of the token budget; never throws.

vi.mock('../kairos-today', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kairos-today')>()
  return { ...actual, listTodayEntries: vi.fn() }
})
vi.mock('@/lib/db', () => ({ db: {} }))

import { listTodayEntries, type TodayRow } from '../kairos-today'
import { TODAY_CONTEXT_SHARE, loadTodayContextSection } from '../prepare-context-today'
import { prepareContextSchema } from '../validators/memory'

const USER = 'user-1'
const NOW = new Date('2026-10-03T10:05:00.000Z')

const row = (at: string, payload: Record<string, unknown>): TodayRow => ({
  createdAt: new Date(at),
  toolName: String(payload.channel),
  payload: { v: 1, key: at, covered: null, origin: { kind: 'operator' }, ...payload },
})

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KAIROS_TODAY
})

afterEach(() => {
  delete process.env.KAIROS_TODAY
})

describe('loadTodayContextSection', () => {
  it('renders a Telegram message from 10:00 labelled owner·telegram, inside the DATA markers', async () => {
    vi.mocked(listTodayEntries).mockResolvedValue([
      row('2026-10-03T10:00:00.000Z', { channel: 'telegram', type: 'said', speaker: 'owner', text: 'Ship the Aeon fix today.' }),
    ])

    const md = await loadTodayContextSection(USER, 4000, NOW)

    expect(md).toMatch(/^## Today across channels/)
    expect(md).toContain('- 10:00 owner·telegram said: "Ship the Aeon fix today."')
    expect(md.indexOf('BEGIN TODAY DATA')).toBeLessThan(md.indexOf('owner·telegram'))
    expect(md.trimEnd().endsWith('END TODAY DATA')).toBe(true)
    expect(listTodayEntries).toHaveBeenCalledWith(USER, expect.objectContaining({ hours: 24, now: NOW }))
  })

  it('stays within 15% of the token budget (≈4 chars/token), dropping the oldest first', async () => {
    vi.mocked(listTodayEntries).mockResolvedValue(Array.from({ length: 60 }, (_, i) =>
      row(new Date(NOW.getTime() - (60 - i) * 60_000).toISOString(), { channel: 'web', type: 'said', speaker: 'owner', text: `message ${i} ${'x'.repeat(200)}` })))

    const md = await loadTodayContextSection(USER, 2000, NOW)

    expect(md.length).toBeLessThanOrEqual(Math.floor(2000 * TODAY_CONTEXT_SHARE) * 4)
    expect(md).toContain('message 59')
    expect(md).toMatch(/earlier entr(y|ies) omitted/)
  })

  it("is empty when the flag is off, the log is empty, or the read fails — and doesn't throw", async () => {
    process.env.KAIROS_TODAY = '0'
    expect(await loadTodayContextSection(USER, 4000, NOW)).toBe('')
    expect(listTodayEntries).not.toHaveBeenCalled()
    delete process.env.KAIROS_TODAY

    vi.mocked(listTodayEntries).mockResolvedValueOnce([])
    expect(await loadTodayContextSection(USER, 4000, NOW)).toBe('')

    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(listTodayEntries).mockRejectedValueOnce(new Error('pool timeout'))
    expect(await loadTodayContextSection(USER, 4000, NOW)).toBe('')
  })
})

describe('prepareContextSchema.includeToday', () => {
  it('defaults to true and can be turned off', () => {
    expect(prepareContextSchema.parse({ query: 'aeon deploy' }).includeToday).toBe(true)
    expect(prepareContextSchema.parse({ query: 'aeon deploy', includeToday: false }).includeToday).toBe(false)
  })
})
