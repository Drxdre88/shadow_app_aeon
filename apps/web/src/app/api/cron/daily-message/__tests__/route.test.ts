import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/kairos/daily-message', () => ({
  runDailyMessageForUser: vi.fn(),
}))

import { runDailyMessageForUser } from '@/lib/kairos/daily-message'
import { GET } from '../route'

const OPERATOR = 'operator-user-1'

function request(query = '', authorization?: string) {
  return {
    url: `https://aeon.test/api/cron/daily-message${query}`,
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  vi.mocked(runDailyMessageForUser).mockResolvedValue({ status: 'sent', date: '2026-10-01', source: 'api' })
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.KAIROS_OPERATOR_USER_ID
})

describe('cron/daily-message route', () => {
  it('rejects with 401 when the bearer secret is configured and missing', async () => {
    process.env.CRON_SECRET = 'secret'
    const res = await GET(request('?force=1'))
    expect(res.status).toBe(401)
    expect(runDailyMessageForUser).not.toHaveBeenCalled()
  })

  it('runs in the BST 07:00Z slot (08:00 London) and skips the 08:00Z slot (09:00 London)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T07:00:00.000Z'))
    let body = await (await GET(request())).json()
    expect(body).toMatchObject({ ran: true, status: 'sent' })
    expect(runDailyMessageForUser).toHaveBeenCalledWith(OPERATOR, { now: new Date('2026-10-01T07:00:00.000Z'), dryRun: false })

    vi.mocked(runDailyMessageForUser).mockClear()
    vi.setSystemTime(new Date('2026-10-01T08:00:00.000Z'))
    body = await (await GET(request())).json()
    expect(body).toEqual({ ran: false, reason: 'not 8:00 in Europe/London' })
    expect(runDailyMessageForUser).not.toHaveBeenCalled()
  })

  it('in GMT (after 2026-10-25) runs only the 08:00Z slot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T07:00:00.000Z'))
    expect(await (await GET(request())).json()).toMatchObject({ ran: false })
    vi.setSystemTime(new Date('2026-10-26T08:00:00.000Z'))
    expect(await (await GET(request())).json()).toMatchObject({ ran: true })
    expect(runDailyMessageForUser).toHaveBeenCalledTimes(1)
  })

  it('?force=1 runs outside the London hour (with the secret)', async () => {
    process.env.CRON_SECRET = 'secret'
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T13:00:00.000Z'))
    const res = await GET(request('?force=1', 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(runDailyMessageForUser).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({ dryRun: false }))
  })

  it('?dryRun=1 composes without delivering and returns the message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T13:00:00.000Z'))
    vi.mocked(runDailyMessageForUser).mockResolvedValue({ status: 'dry_run', date: '2026-10-01', source: 'deterministic', message: 'hi' })
    const body = await (await GET(request('?dryRun=1'))).json()
    expect(runDailyMessageForUser).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({ dryRun: true }))
    expect(body).toMatchObject({ ran: true, status: 'dry_run', message: 'hi' })
  })

  it('returns ran:false when KAIROS_OPERATOR_USER_ID is unset', async () => {
    delete process.env.KAIROS_OPERATOR_USER_ID
    const body = await (await GET(request('?force=1'))).json()
    expect(body).toEqual({ ran: false, reason: 'KAIROS_OPERATOR_USER_ID unset' })
    expect(runDailyMessageForUser).not.toHaveBeenCalled()
  })
})
