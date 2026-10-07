import { beforeEach, describe, expect, it, vi } from 'vitest'

const data = vi.hoisted(() => ({
  findOpenKairosDecisionBySeq: vi.fn(),
  settleKairosDecisionByOwner: vi.fn(),
}))
vi.mock('@/lib/data/kairos-decisions', () => data)

import { parseDecisionCommands, routeDecisionCommands } from '../telegram-commands'

const USER = 'operator'
const ID = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.clearAllMocks()
  data.findOpenKairosDecisionBySeq.mockResolvedValue({ id: ID, seq: 3 })
  data.settleKairosDecisionByOwner.mockResolvedValue({ ok: true })
})

describe('parseDecisionCommands', () => {
  it('reads D<n> right|wrong|void and "void D<n>"', () => {
    expect(parseDecisionCommands('D3 right')).toEqual([{ seq: 3, verdict: 'right' }])
    expect(parseDecisionCommands('d4 Wrong.\nvoid D5\nD6 void')).toEqual([
      { seq: 4, verdict: 'wrong' }, { seq: 5, verdict: 'void' }, { seq: 6, verdict: 'void' },
    ])
  })

  it('anything else is not a command', () => {
    for (const body of ['R3 right', 'D3 right because x', 'decide: hire', 'D3', '']) expect(parseDecisionCommands(body)).toBeNull()
  })
})

describe('routeDecisionCommands', () => {
  it('settles as the owner via Telegram and acks in one line', async () => {
    const send = vi.fn(async () => undefined)
    expect(await routeDecisionCommands(USER, 'D3 right', send)).toBe(true)
    expect(data.settleKairosDecisionByOwner).toHaveBeenCalledWith(USER, ID, 'right', { via: 'telegram' }, expect.any(Date))
    expect(send).toHaveBeenCalledWith('✓ D3 right')
  })

  it('reports missing, settled and unconfirmed relayed decisions', async () => {
    const send = vi.fn(async () => undefined)
    data.findOpenKairosDecisionBySeq.mockResolvedValueOnce(null)
    data.settleKairosDecisionByOwner
      .mockResolvedValueOnce({ ok: false, reason: 'unconfirmed' })
      .mockResolvedValueOnce({ ok: false, reason: 'already_settled' })
    await routeDecisionCommands(USER, 'D9 right\nD3 wrong\nD3 void', send)
    expect(send).toHaveBeenCalledWith('D9: no open decision · D3: relayed — confirm it in the app first · D3: already settled')
  })

  it('plain chat never loads the journal', async () => {
    const send = vi.fn(async () => undefined)
    expect(await routeDecisionCommands(USER, 'ship hydra friday', send)).toBe(false)
    expect(data.findOpenKairosDecisionBySeq).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('a failing command acks a retry instead of throwing', async () => {
    const send = vi.fn(async () => undefined)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    data.findOpenKairosDecisionBySeq.mockRejectedValueOnce(new Error('db down'))
    expect(await routeDecisionCommands(USER, 'D3 right', send)).toBe(true)
    expect(send).toHaveBeenCalledWith('D3: could not update — try again')
    spy.mockRestore()
  })
})
