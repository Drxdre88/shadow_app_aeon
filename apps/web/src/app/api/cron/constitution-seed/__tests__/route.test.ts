import { beforeEach, describe, expect, it, vi } from 'vitest'

// Constitution seed cron (docs/kairos/34 §2): bearer-gated, per-user isolated,
// a success trace only when a draft was created and a failure trace for an
// error result or a thrown seed.

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/constitution', () => ({
  listUsersForConstitutionSeed: vi.fn(),
}))

vi.mock('@/lib/kairos/constitution/seed', () => ({
  seedConstitutionDraft: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
  writeCronSuccessTrace: vi.fn(),
}))

import { listUsersForConstitutionSeed } from '@/lib/data/constitution'
import { seedConstitutionDraft } from '@/lib/kairos/constitution/seed'
import { writeCronFailureTrace, writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import { GET } from '../route'

const SECRET = 'cron-secret'

function request(authorization?: string) {
  return {
    url: 'https://aeon.test/api/cron/constitution-seed',
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/constitution-seed route', () => {
  it('returns 401 without the configured CRON_SECRET and never lists users', async () => {
    process.env.CRON_SECRET = SECRET

    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('Bearer wrong'))).status).toBe(401)
    expect(listUsersForConstitutionSeed).not.toHaveBeenCalled()
    expect(seedConstitutionDraft).not.toHaveBeenCalled()
  })

  it('refuses in production when CRON_SECRET is unset', async () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    expect((await GET(request())).status).toBe(401)
    expect(listUsersForConstitutionSeed).not.toHaveBeenCalled()
  })

  it('isolates per-user failures and writes success/failure traces per outcome', async () => {
    process.env.CRON_SECRET = SECRET
    vi.mocked(listUsersForConstitutionSeed).mockResolvedValue(['u-created', 'u-throws', 'u-error', 'u-skipped'])
    vi.mocked(seedConstitutionDraft).mockImplementation(async (userId: string) => {
      if (userId === 'u-created') return { status: 'created', proposalId: 'p-1', principles: 5 }
      if (userId === 'u-throws') throw new Error('provider exploded')
      if (userId === 'u-error') return { status: 'error', reason: 'invalid_draft' }
      return { status: 'skipped', reason: 'constitution exists' }
    })

    const response = await GET(request(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    const body = await response.json()

    // Every user was attempted despite the throw on the second.
    expect(seedConstitutionDraft).toHaveBeenCalledTimes(4)
    expect(body.ran).toBe(4)
    expect(body.created).toBe(1)
    expect(body.users).toEqual([
      { userId: 'u-created', result: { status: 'created', proposalId: 'p-1', principles: 5 } },
      { userId: 'u-throws', error: 'provider exploded' },
      { userId: 'u-error', result: { status: 'error', reason: 'invalid_draft' } },
      { userId: 'u-skipped', result: { status: 'skipped', reason: 'constitution exists' } },
    ])

    expect(writeCronSuccessTrace).toHaveBeenCalledTimes(1)
    expect(writeCronSuccessTrace).toHaveBeenCalledWith('u-created', { cronName: 'constitution-seed' })
    expect(writeCronFailureTrace).toHaveBeenCalledTimes(2)
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u-throws', expect.objectContaining({
      cronName: 'constitution-seed',
      reason: 'uncaught_exception',
    }))
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u-error', { cronName: 'constitution-seed', reason: 'invalid_draft' })
  })

  it('reports an empty run when no user is eligible', async () => {
    process.env.CRON_SECRET = SECRET
    vi.mocked(listUsersForConstitutionSeed).mockResolvedValue([])

    const body = await (await GET(request(`Bearer ${SECRET}`))).json()
    expect(body).toEqual({ ran: 0, created: 0, users: [] })
    expect(seedConstitutionDraft).not.toHaveBeenCalled()
  })
})
