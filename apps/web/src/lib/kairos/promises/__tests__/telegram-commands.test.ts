import { beforeEach, describe, expect, it, vi } from 'vitest'

// Owner promise commands from the operator's Telegram chat: "P3 kept",
// "drop P3", "P3 by dd/mm" (London year logic). Closes go through the one
// close function with the owner closer.

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/kairos-promises', () => ({ findOpenKairosPromiseBySeq: vi.fn() }))
vi.mock('../close', () => ({ closeKairosPromise: vi.fn(), renegotiateKairosPromise: vi.fn() }))

import { findOpenKairosPromiseBySeq } from '@/lib/data/kairos-promises'
import { closeKairosPromise, renegotiateKairosPromise } from '../close'
import { parsePromiseCommands, resolveDayMonth, routePromiseCommands } from '../telegram-commands'

const USER = 'operator-1'
const P3 = { id: 'p-3', seq: 3 } as never
// 2 Oct 2026, 10:00 London.
const NOW = new Date('2026-10-02T09:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findOpenKairosPromiseBySeq).mockResolvedValue(P3)
})

describe('parsePromiseCommands', () => {
  it('reads the three commands, case- and punctuation-tolerant', () => {
    expect(parsePromiseCommands('P3 kept')).toEqual([{ kind: 'kept', seq: 3 }])
    expect(parsePromiseCommands('p12 KEPT.')).toEqual([{ kind: 'kept', seq: 12 }])
    expect(parsePromiseCommands('drop P3!')).toEqual([{ kind: 'drop', seq: 3 }])
    expect(parsePromiseCommands('P3 by 20/10')).toEqual([{ kind: 'move', seq: 3, day: 20, month: 10 }])
    expect(parsePromiseCommands('P3 kept\ndrop P5')).toEqual([{ kind: 'kept', seq: 3 }, { kind: 'drop', seq: 5 }])
  })

  it('anything else is not a command (falls through to chat)', () => {
    expect(parsePromiseCommands('P3 kept, and how are the boards?')).toBeNull()
    expect(parsePromiseCommands('P3 kept\nalso what about Hydra')).toBeNull()
    expect(parsePromiseCommands('I kept P3')).toBeNull()
    expect(parsePromiseCommands('Q3: kept')).toBeNull()
    expect(parsePromiseCommands('   ')).toBeNull()
  })
})

describe('resolveDayMonth (London year)', () => {
  it('this year when still ahead, next year once passed or today', () => {
    expect(resolveDayMonth(20, 10, NOW)).toBe('2026-10-20')
    expect(resolveDayMonth(2, 10, NOW)).toBe('2027-10-02')
    expect(resolveDayMonth(5, 1, NOW)).toBe('2027-01-05')
  })

  it('uses the London date, not UTC, around midnight', () => {
    // 31 Dec 2026 23:30 UTC is still 31 Dec in London (GMT); 1 Jan is ahead.
    expect(resolveDayMonth(1, 1, new Date('2026-12-31T23:30:00.000Z'))).toBe('2027-01-01')
    // 30 Sep 23:30 UTC is already 1 Oct 00:30 in London (BST): 1/10 is "today" → next year.
    expect(resolveDayMonth(1, 10, new Date('2026-09-30T23:30:00.000Z'))).toBe('2027-10-01')
  })

  it('null for a date that does not exist; 29/02 rolls to the next leap-valid year', () => {
    expect(resolveDayMonth(31, 2, NOW)).toBeNull()
    expect(resolveDayMonth(31, 13, NOW)).toBeNull()
    expect(resolveDayMonth(29, 2, new Date('2027-10-02T09:00:00.000Z'))).toBe('2028-02-29')
  })
})

describe('routePromiseCommands', () => {
  it('"P3 kept" closes as the owner via Telegram and acks', async () => {
    vi.mocked(closeKairosPromise).mockResolvedValue({ ok: true, promise: P3 })
    const send = vi.fn(async () => undefined)
    expect(await routePromiseCommands(USER, 'P3 kept', send, NOW)).toBe(true)
    expect(findOpenKairosPromiseBySeq).toHaveBeenCalledWith(USER, 3)
    expect(closeKairosPromise).toHaveBeenCalledWith(USER, 'p-3', { kind: 'owner', via: 'telegram', verdict: 'kept' }, NOW)
    expect(send).toHaveBeenCalledWith('✓ P3 kept')
  })

  it('"drop P3" drops', async () => {
    vi.mocked(closeKairosPromise).mockResolvedValue({ ok: true, promise: P3 })
    const send = vi.fn(async () => undefined)
    await routePromiseCommands(USER, 'drop P3', send, NOW)
    expect(closeKairosPromise).toHaveBeenCalledWith(USER, 'p-3', { kind: 'owner', via: 'telegram', verdict: 'dropped' }, NOW)
    expect(send).toHaveBeenCalledWith('✓ P3 dropped')
  })

  it('"P3 by 20/10" renegotiates to YYYY-MM-DD', async () => {
    vi.mocked(renegotiateKairosPromise).mockResolvedValue({ ok: true, promise: P3 })
    const send = vi.fn(async () => undefined)
    await routePromiseCommands(USER, 'P3 by 20/10', send, NOW)
    expect(renegotiateKairosPromise).toHaveBeenCalledWith(USER, 'p-3', '2026-10-20', { kind: 'owner', via: 'telegram' }, NOW)
    expect(send).toHaveBeenCalledWith('✓ P3 now due 20/10')
  })

  it('explains an out-of-window date, an unknown P-number and a non-date', async () => {
    vi.mocked(renegotiateKairosPromise).mockResolvedValue({ ok: false, reason: 'due_out_of_window' })
    const send = vi.fn(async () => undefined)
    await routePromiseCommands(USER, 'P3 by 20/12', send, NOW)
    expect(send).toHaveBeenLastCalledWith('P3: pick a date from 03/10 to 30/10')

    vi.mocked(findOpenKairosPromiseBySeq).mockResolvedValueOnce(null)
    await routePromiseCommands(USER, 'P9 kept', send, NOW)
    expect(send).toHaveBeenLastCalledWith('P9: no open promise')

    await routePromiseCommands(USER, 'P3 by 31/02', send, NOW)
    expect(send).toHaveBeenLastCalledWith('P3: 31/02 is not a date')
  })

  it('several commands get one combined ack; a failing one does not stop the rest', async () => {
    vi.mocked(closeKairosPromise).mockRejectedValueOnce(new Error('locked')).mockResolvedValueOnce({ ok: true, promise: P3 })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const send = vi.fn(async () => undefined)
    await routePromiseCommands(USER, 'P3 kept\ndrop P3', send, NOW)
    expect(send).toHaveBeenCalledWith('P3: could not update — try again · ✓ P3 dropped')
    errorSpy.mockRestore()
  })

  it('non-commands are not handled and send nothing', async () => {
    const send = vi.fn(async () => undefined)
    expect(await routePromiseCommands(USER, 'morning!', send, NOW)).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(findOpenKairosPromiseBySeq).not.toHaveBeenCalled()
  })
})
