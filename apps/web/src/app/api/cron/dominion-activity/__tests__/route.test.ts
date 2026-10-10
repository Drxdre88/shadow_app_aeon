import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/dominion-activity', () => ({
  listDominionActivityUserIds: vi.fn(),
  scoreDominionActivityForUser: vi.fn(),
}))
vi.mock('@/lib/kairos/cron-trace', () => ({ writeCronFailureTrace: vi.fn() }))

import { listDominionActivityUserIds, scoreDominionActivityForUser } from '@/lib/data/dominion-activity'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { GET } from '../route'

function request(authorization?: string) {
  return {
    url: 'https://aeon.test/api/cron/dominion-activity',
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

const run = (userId: string) => ({ userId, scored: 2, dormant: 0, unattributedBoards: 0, unattributedRepos: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  process.env.KAIROS_LIVING_DOMINIONS = 'observe'
  vi.mocked(listDominionActivityUserIds).mockResolvedValue(['u1', 'u2'])
  vi.mocked(scoreDominionActivityForUser).mockImplementation(async (userId) => run(userId))
})

describe('cron/dominion-activity route', () => {
  it('rejects without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const response = await GET(request('Bearer wrong'))
    expect(response.status).toBe(401)
    expect(listDominionActivityUserIds).not.toHaveBeenCalled()
  })

  it('accepts the bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await GET(request('Bearer cron-secret'))).status).toBe(200)
  })

  it('skips without touching the database when the switch is off', async () => {
    delete process.env.KAIROS_LIVING_DOMINIONS
    const body = await (await GET(request())).json()
    expect(body).toEqual({ skipped: 'off' })
    expect(listDominionActivityUserIds).not.toHaveBeenCalled()
    expect(scoreDominionActivityForUser).not.toHaveBeenCalled()
  })

  it.each(['observe', '1'])('scores every user in mode %s', async (raw) => {
    process.env.KAIROS_LIVING_DOMINIONS = raw
    const body = await (await GET(request())).json()
    expect(body).toEqual({ mode: raw === '1' ? 'on' : 'observe', ran: 2, failed: 0, users: [run('u1'), run('u2')] })
    expect(scoreDominionActivityForUser).toHaveBeenCalledWith('u1')
    expect(scoreDominionActivityForUser).toHaveBeenCalledWith('u2')
  })

  it('isolates a failing user, traces it and keeps going', async () => {
    vi.mocked(scoreDominionActivityForUser).mockRejectedValueOnce(new Error('db hiccup'))
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 2, failed: 1 })
    expect(body.users).toEqual([{ userId: 'u1', error: 'db hiccup' }, run('u2')])
    expect(writeCronFailureTrace).toHaveBeenCalledWith('u1', expect.objectContaining({
      cronName: 'dominion-activity',
      reason: 'uncaught_exception',
    }))
    expect(writeCronFailureTrace).toHaveBeenCalledTimes(1)
  })

  it('leaves beta testers out of the run entirely', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    vi.stubEnv('VORATH_USER_IDS', 'u2')
    try {
      const body = await (await GET(request(['Bearer', 'cron-secret'].join(' ')))).json()
      expect(body).toMatchObject({ ran: 1, users: [run('u2')] })
      expect(scoreDominionActivityForUser).toHaveBeenCalledTimes(1)
      expect(scoreDominionActivityForUser).not.toHaveBeenCalledWith('u1')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
