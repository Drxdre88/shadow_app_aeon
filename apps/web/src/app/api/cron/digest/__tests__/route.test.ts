import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/kairos/digest', () => ({
  runEveningDigestForUser: vi.fn(),
}))

import { runEveningDigestForUser } from '@/lib/kairos/digest'
import { GET } from '../route'

const OPERATOR = 'operator-user-1'

function request(authorization?: string) {
  return {
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  delete process.env.KAIROS_OPERATOR_USER_ID
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/digest route', () => {
  it('rejects with 401 when the bearer secret is configured and missing', async () => {
    process.env.CRON_SECRET = 'secret'
    const res = await GET(request())
    expect(res.status).toBe(401)
    expect(runEveningDigestForUser).not.toHaveBeenCalled()
  })

  it('accepts the correctly-bearer-authenticated request', async () => {
    process.env.CRON_SECRET = 'secret'
    process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
    vi.mocked(runEveningDigestForUser).mockResolvedValue({ status: 'sent', date: '2026-07-24' })

    const res = await GET(request('Bearer secret'))
    expect(res.status).toBe(200)
    expect(runEveningDigestForUser).toHaveBeenCalledWith(OPERATOR)
  })

  it('returns 200 with ran:false and never calls the digest when KAIROS_OPERATOR_USER_ID is unset', async () => {
    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ran: false, reason: 'KAIROS_OPERATOR_USER_ID unset' })
    expect(runEveningDigestForUser).not.toHaveBeenCalled()
  })

  it('always returns 200 with the digest outcome in the body, even on a skipped run', async () => {
    process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
    vi.mocked(runEveningDigestForUser).mockResolvedValue({ status: 'skipped', reason: 'already ran today' })

    const res = await GET(request())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ran: true, status: 'skipped', reason: 'already ran today' })
  })
})
