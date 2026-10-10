import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { SpendCapReached, SpendGuard, SpendMeter, isSpendCapReached, parseDailySpendCap } from '../spend'

const USER = 'u1'
const NOON = Date.UTC(2026, 9, 10, 12, 0, 0)

function makeGuard(spent: number, cap: number | null = 5) {
  const clock = { now: NOON }
  const readSpend = vi.fn(async (_userId: string, _since: Date) => spent)
  const guard = new SpendGuard({ readSpend, capUsd: () => cap, now: () => clock.now, ttlMs: 30_000 })
  return { guard, readSpend, clock }
}

let warn: ReturnType<typeof vi.spyOn>
let info: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseDailySpendCap', () => {
  it('defaults to 5, accepts numbers, and "off" disables', () => {
    expect(parseDailySpendCap(undefined)).toBe(5)
    expect(parseDailySpendCap('')).toBe(5)
    expect(parseDailySpendCap('12.5')).toBe(12.5)
    expect(parseDailySpendCap('0')).toBe(0)
    expect(parseDailySpendCap('OFF')).toBeNull()
    expect(parseDailySpendCap('lots')).toBe(5)
    expect(parseDailySpendCap('-1')).toBe(5)
  })
})

describe('SpendGuard', () => {
  it('allows a call under the cap and reads from UTC midnight', async () => {
    const { guard, readSpend } = makeGuard(4.99)
    await expect(guard.check(USER)).resolves.toBeUndefined()
    expect(readSpend).toHaveBeenCalledWith(USER, new Date(Date.UTC(2026, 9, 10)))
  })

  it('refuses at or over the cap with SpendCapReached', async () => {
    const { guard } = makeGuard(5)
    const err = await guard.check(USER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SpendCapReached)
    expect(isSpendCapReached(err)).toBe(true)
    expect((err as Error).name).toBe('SpendCapReached')
    expect((err as Error).message).toMatch(/daily AI budget reached/)
  })

  it('warns once per day however many calls are refused', async () => {
    const { guard, clock } = makeGuard(9)
    await guard.check(USER).catch(() => {})
    await guard.check(USER).catch(() => {})
    expect(warn).toHaveBeenCalledTimes(1)
    clock.now += 86_400_000
    await guard.check(USER).catch(() => {})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('caches the day total for the TTL, then re-reads', async () => {
    const { guard, readSpend, clock } = makeGuard(1)
    await guard.check(USER)
    await guard.check(USER)
    expect(readSpend).toHaveBeenCalledTimes(1)
    clock.now += 30_000
    await guard.check(USER)
    expect(readSpend).toHaveBeenCalledTimes(2)
  })

  it('adds recorded cost to the cached total so the cap trips before the next read', async () => {
    const { guard, readSpend } = makeGuard(4)
    await guard.check(USER)
    guard.add(USER, 1.5)
    await expect(guard.check(USER)).rejects.toBeInstanceOf(SpendCapReached)
    expect(readSpend).toHaveBeenCalledTimes(1)
  })

  it('re-reads on a new UTC day even inside the TTL', async () => {
    const { guard, readSpend, clock } = makeGuard(1)
    clock.now = Date.UTC(2026, 9, 10, 23, 59, 50)
    await guard.check(USER)
    clock.now += 20_000
    await guard.check(USER)
    expect(readSpend).toHaveBeenCalledTimes(2)
  })

  it('never reads when the cap is off', async () => {
    const { guard, readSpend } = makeGuard(1000, null)
    await guard.check(USER)
    expect(readSpend).not.toHaveBeenCalled()
  })

  it('fails open when the ledger read fails', async () => {
    const guard = new SpendGuard({ readSpend: async () => { throw new Error('db down') }, capUsd: () => 5, now: () => NOON })
    await expect(guard.check(USER)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

describe('SpendMeter.record', () => {
  const event = {
    userId: USER,
    task: 'voice_chat',
    providerId: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    latencyMs: 812.4,
    ok: true,
  }

  it('writes a row and logs one [ai-usage] JSON line', async () => {
    const write = vi.fn(async () => {})
    const { guard } = makeGuard(0)
    new SpendMeter(guard, write, () => NOON).record(event)
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      task: 'voice_chat',
      modelId: 'claude-sonnet-5-5',
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: '0.004000',
      latencyMs: 812,
      ok: true,
      error: null,
      createdAt: new Date(NOON),
    }))
    const [prefix, line] = info.mock.calls[0] as [string, string]
    expect(prefix).toBe('[ai-usage]')
    expect(JSON.parse(line)).toMatchObject({ task: 'voice_chat', model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 200, costUsd: 0.004, ms: 812, ok: true })
  })

  it('records an error with its name and message', async () => {
    const write = vi.fn(async () => {})
    const { guard } = makeGuard(0)
    new SpendMeter(guard, write).record({ ...event, usage: undefined, ok: false, error: new TypeError('boom') })
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'TypeError: boom', costUsd: '0.000000' }))
  })

  it('swallows write failures, sync or async', async () => {
    const { guard } = makeGuard(0)
    const asyncFail = vi.fn(async () => { throw new Error('insert failed') })
    const syncFail = vi.fn(() => { throw new Error('sync fail') }) as unknown as () => Promise<void>
    expect(() => new SpendMeter(guard, asyncFail).record(event)).not.toThrow()
    expect(() => new SpendMeter(guard, syncFail).record(event)).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2))
  })
})
