import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
  listRecentKairosSpeaks: vi.fn(),
}))

import { captureMemory, listRecentKairosSpeaks } from '@/lib/data/memories'
import { POST } from '../route'

const OPERATOR = 'operator-user-1'
const MEMORY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeReq(body: unknown, authHeader?: string) {
  const headers = new Map<string, string>()
  if (authHeader) headers.set('authorization', authHeader)
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0]
}

function fetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  process.env.CRON_SECRET = 'cron-secret'
  process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = '12345'
  vi.mocked(captureMemory).mockResolvedValue({
    memory: { id: MEMORY_ID } as never,
    created: true,
  })
  vi.mocked(listRecentKairosSpeaks).mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CRON_SECRET
  delete process.env.KAIROS_OPERATOR_USER_ID
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
})

describe('POST /api/v1/kairos/speak', () => {
  it('rejects with 401 when the bearer secret is missing or wrong', async () => {
    vi.stubGlobal('fetch', fetchOk())
    expect((await POST(makeReq({ title: 't', message: 'm' }))).status).toBe(401)
    expect((await POST(makeReq({ title: 't', message: 'm' }, 'Bearer wrong'))).status).toBe(401)
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('fails 500 with a clear message when KAIROS_OPERATOR_USER_ID is unset', async () => {
    delete process.env.KAIROS_OPERATOR_USER_ID
    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('KAIROS_OPERATOR_USER_ID')
  })

  it('rejects an invalid body with 400', async () => {
    const res = await POST(makeReq({ title: '' }, 'Bearer cron-secret'))
    expect(res.status).toBe(400)
  })

  it('captures an inbox notify memory and fans out to Telegram', async () => {
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq(
      { title: 'Deploy done', message: 'All green.', urgency: 'high' },
      'Bearer cron-secret',
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: MEMORY_ID,
      delivered: { inbox: true, telegram: true },
    })
    expect(captureMemory).toHaveBeenCalledWith(OPERATOR, {
      title: 'Deploy done',
      bodyMd: 'All green.',
      summary: 'All green.',
      type: 'inbound',
      source: 'system',
      sourceMetadata: { kairosSpeak: true, status: 'pending', kind: 'notify', urgency: 'high' },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.telegram.org/botbot-token/sendMessage')
  })

  it('does not fail the request when Telegram delivery throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect((await res.json()).delivered).toEqual({ inbox: true, telegram: false })
  })

  it('throttles with 429 when a speak landed within the minimum gap', async () => {
    const lastSpokeAt = new Date(Date.now() - 30 * 60 * 1000)
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue([
      { id: 'm1', title: 'earlier', createdAt: lastSpokeAt },
    ] as never)
    vi.stubGlobal('fetch', fetchOk())

    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toBe('throttled')
    expect(body.spokenLast24h).toBe(1)
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('throttles with 429 at the daily cap even when the gap has passed', async () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000)
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue([
      { id: 'm1', title: 'a', createdAt: hoursAgo(6) },
      { id: 'm2', title: 'b', createdAt: hoursAgo(12) },
      { id: 'm3', title: 'c', createdAt: hoursAgo(18) },
    ] as never)
    vi.stubGlobal('fetch', fetchOk())

    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect(res.status).toBe(429)
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('force bypasses the gap and daily cap', async () => {
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue([
      { id: 'm1', title: 'earlier', createdAt: new Date() },
      { id: 'm2', title: 'earlier2', createdAt: new Date() },
      { id: 'm3', title: 'earlier3', createdAt: new Date() },
    ] as never)
    vi.stubGlobal('fetch', fetchOk())

    const res = await POST(makeReq({ title: 't', message: 'm', force: true }, 'Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(captureMemory).toHaveBeenCalledOnce()
  })

  it('force still throttles at the absolute ceiling', async () => {
    vi.mocked(listRecentKairosSpeaks).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `m${i}`, title: `t${i}`, createdAt: new Date(),
      })) as never,
    )
    vi.stubGlobal('fetch', fetchOk())

    const res = await POST(makeReq({ title: 't', message: 'm', force: true }, 'Bearer cron-secret'))
    expect(res.status).toBe(429)
    expect(captureMemory).not.toHaveBeenCalled()
  })

  it('reports telegram:false when the channel is unconfigured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect((await res.json()).delivered).toEqual({ inbox: true, telegram: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
