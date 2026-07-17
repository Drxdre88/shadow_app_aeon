import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/kairos-chat', () => ({
  listChatDistillEligibleUserIds: vi.fn(),
}))

vi.mock('@/lib/kairos/chat-distill', () => ({
  runChatDistillForUser: vi.fn(),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { listChatDistillEligibleUserIds } from '@/lib/data/kairos-chat'
import { runChatDistillForUser } from '@/lib/kairos/chat-distill'
import { GET } from '../route'

function request(authorization?: string) {
  return {
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
})

describe('cron/chat-distill route', () => {
  it('returns 401 without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(listChatDistillEligibleUserIds).not.toHaveBeenCalled()
  })

  it('runs each eligible user and totals created reflections', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    ;(listChatDistillEligibleUserIds as ReturnType<typeof vi.fn>).mockResolvedValue(['user-1'])
    ;(runChatDistillForUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: '2026-07-16',
      dryRun: false,
      reflectionsCreated: 2,
      threads: [],
    })

    const response = await GET(request('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ran: 1, reflectionsCreated: 2 })
    expect(runChatDistillForUser).toHaveBeenCalledWith('user-1')
  })
})
