import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  closeKairosPromise: vi.fn(),
  renegotiateKairosPromise: vi.fn(),
  listKairosPromises: vi.fn(),
}))

vi.mock('@/lib/actions/helpers', () => ({ requireAuth: m.requireAuth }))
vi.mock('@/lib/kairos/promises/close', () => ({
  closeKairosPromise: m.closeKairosPromise,
  renegotiateKairosPromise: m.renegotiateKairosPromise,
}))
vi.mock('@/lib/data/kairos-promises', () => ({
  listKairosPromises: m.listKairosPromises,
  toKairosPromiseView: (p: { seq: number }) => ({ number: `P${p.seq}` }),
}))

import { dropKairosPromise, keepKairosPromise, listOwnKairosPromises, renegotiateOwnKairosPromise } from '../kairos-promises'

const ID = '00000000-0000-4000-8000-000000000003'

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAuth.mockResolvedValue('user-1')
  m.closeKairosPromise.mockResolvedValue({ ok: true })
  m.renegotiateKairosPromise.mockResolvedValue({ ok: true })
  m.listKairosPromises.mockResolvedValue([{ seq: 3 }])
})

describe('owner promise actions', () => {
  it('keep / drop close as the owner via the web session', async () => {
    await keepKairosPromise(ID)
    await dropKairosPromise(ID)
    expect(m.closeKairosPromise).toHaveBeenNthCalledWith(1, 'user-1', ID, { kind: 'owner', via: 'session', verdict: 'kept' })
    expect(m.closeKairosPromise).toHaveBeenNthCalledWith(2, 'user-1', ID, { kind: 'owner', via: 'session', verdict: 'dropped' })
  })

  it('renegotiate validates the date and acts as the owner', async () => {
    await renegotiateOwnKairosPromise(ID, '2026-10-20')
    expect(m.renegotiateKairosPromise).toHaveBeenCalledWith('user-1', ID, '2026-10-20', { kind: 'owner', via: 'session' })
    await expect(renegotiateOwnKairosPromise(ID, '20/10')).rejects.toThrow()
  })

  it('requires a session and a uuid', async () => {
    m.requireAuth.mockRejectedValueOnce(new Error('Unauthorized'))
    await expect(keepKairosPromise(ID)).rejects.toThrow('Unauthorized')
    await expect(dropKairosPromise('P3')).rejects.toThrow()
    expect(m.closeKairosPromise).not.toHaveBeenCalled()
  })

  it('lists the owner\'s promises', async () => {
    expect(await listOwnKairosPromises('all')).toEqual([{ number: 'P3' }])
    expect(m.listKairosPromises).toHaveBeenCalledWith('user-1', { scope: 'all' })
  })
})
