import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ find: vi.fn(), settle: vi.fn() }))
vi.mock('@/lib/data/kairos-predictions', () => ({ findOpenKairosPredictionBySeq: h.find }))
vi.mock('../verdict', () => ({ settleKairosPredictionByOwner: h.settle }))

import { parsePredictionCommands, routePredictionCommands } from '../telegram-commands'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_PREDICTIONS = '1'
})

describe('parsePredictionCommands', () => {
  it.each([
    ['R3 right', [{ seq: 3, verdict: 'right' }]],
    ['r12 WRONG.', [{ seq: 12, verdict: 'wrong' }]],
    ['void R3', [{ seq: 3, verdict: 'void' }]],
    ['  R1 right \n\n void r2 ', [{ seq: 1, verdict: 'right' }, { seq: 2, verdict: 'void' }]],
  ])('parses %j', (body, expected) => {
    expect(parsePredictionCommands(body)).toEqual(expected)
  })

  it.each(['', 'R3', 'R3 right please', 'right R3', 'P3 kept', 'I think R3 was right', 'R3 right\nand also this', 'void R'])(
    'is not a command: %j', (body) => {
      expect(parsePredictionCommands(body)).toBeNull()
    })
})

describe('routePredictionCommands', () => {
  it('flag off: falls through to chat', async () => {
    delete process.env.KAIROS_PREDICTIONS
    const send = vi.fn()
    expect(await routePredictionCommands('u', 'R3 right', send)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('settles via the owner verdict path and acks in one line', async () => {
    h.find.mockImplementation(async (_u: string, seq: number) => (seq === 3 ? { id: 'p3' } : null))
    h.settle.mockResolvedValue({ ok: true })
    const send = vi.fn()
    expect(await routePredictionCommands('u', 'R3 wrong\nvoid R9', send)).toBe(true)
    expect(h.settle).toHaveBeenCalledWith('u', 'p3', 'wrong', { via: 'telegram' }, expect.any(Date))
    expect(send).toHaveBeenCalledWith('✓ R3 wrong · R9: no open prediction')
  })
})
