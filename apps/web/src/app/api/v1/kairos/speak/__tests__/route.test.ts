import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  captureMemory: vi.fn(),
}))

import { captureMemory } from '@/lib/data/memories'
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

  it('reports telegram:false when the channel is unconfigured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const res = await POST(makeReq({ title: 't', message: 'm' }, 'Bearer cron-secret'))
    expect((await res.json()).delivered).toEqual({ inbox: true, telegram: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
