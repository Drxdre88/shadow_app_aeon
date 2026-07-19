import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

vi.mock('@/lib/data/kairos-chat', () => ({
  listChatDistillEligibleUserIds: vi.fn(),
}))

vi.mock('@/lib/kairos/ask-mine', () => ({
  runAskMineForUser: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runAskMineForUser } from '@/lib/kairos/ask-mine'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { GET } from '../route'

function request(path = '/api/cron/ask-mine', authorization?: string) {
  return {
    url: `https://aeon.test${path}`,
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/ask-mine route', () => {
  it('requires the configured bearer secret before reading eligible users', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(listChatDistillEligibleUserIds).not.toHaveBeenCalled()
  })

  it('uses the chat-distill eligibility set and isolates per-user failures', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(runAskMineForUser)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce({
        status: 'created',
        date: '2026-07-19',
        askId: 'ask-2',
        expiresAt: '2026-07-22T04:30:00.000Z',
        candidate: {
          question: 'Should Atlas ship this week?',
          kind: 'decision',
          dominionId: null,
          sourceMemoryIds: ['memory-1'],
          leverage: 0.9,
          rationale: 'It gates two workstreams.',
        },
      })

    const response = await GET(request('/api/cron/ask-mine', 'Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 2, skipped: 0, asksCreated: 1, dryRun: false })
    expect(runAskMineForUser).toHaveBeenNthCalledWith(1, 'user-1', { dryRun: false })
    expect(runAskMineForUser).toHaveBeenNthCalledWith(2, 'user-2', { dryRun: false })
    expect(writeCronFailureTrace).toHaveBeenCalledWith('user-1', expect.objectContaining({
      cronName: 'ask-mine',
      reason: 'uncaught_exception',
    }))
  })

  it('passes the dryRun query flag through to every eligible user', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1'])
    vi.mocked(runAskMineForUser).mockResolvedValue({
      status: 'dry_run',
      date: '2026-07-19',
      signalCount: 4,
      modelInput: { system: 'system', prompt: 'prompt', cacheSystem: true, maxOutputTokens: 4000 },
    })

    const response = await GET(request('/api/cron/ask-mine?dryRun=1', 'Bearer cron-secret'))
    const body = await response.json()

    expect(body).toMatchObject({ ran: 1, asksCreated: 0, dryRun: true })
    expect(runAskMineForUser).toHaveBeenCalledWith('user-1', { dryRun: true })
  })

  it('reports users skipped after the 240-second deadline guard', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    vi.mocked(listChatDistillEligibleUserIds).mockResolvedValue(['user-1', 'user-2'])
    vi.mocked(runAskMineForUser).mockResolvedValue({
      status: 'skipped',
      date: '2026-07-19',
      reason: 'no_candidate',
    })
    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(300_000)

    const response = await GET(request('/api/cron/ask-mine', 'Bearer cron-secret'))
    const body = await response.json()
    nowSpy.mockRestore()

    expect(body).toMatchObject({ ran: 1, skipped: 1, skippedUserIds: ['user-2'] })
    expect(runAskMineForUser).toHaveBeenCalledTimes(1)
  })
})
