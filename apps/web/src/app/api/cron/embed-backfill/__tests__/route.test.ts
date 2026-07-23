import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/data/memories', () => ({
  backfillEmbeddings: vi.fn(),
}))

vi.mock('@/lib/kairos/embeddings', () => ({
  embeddingsEnabled: vi.fn(),
  activeEmbeddingModel: vi.fn(() => 'voyage-3'),
}))

vi.mock('@/lib/kairos/cron-trace', () => ({
  writeCronFailureTrace: vi.fn(),
}))

import { backfillEmbeddings } from '@/lib/data/memories'
import { embeddingsEnabled } from '@/lib/kairos/embeddings'
import { writeCronFailureTrace } from '@/lib/kairos/cron-trace'
import { GET } from '../route'

const OPERATOR = 'operator-user-1'

function request(path = '/api/cron/embed-backfill', authorization?: string) {
  return {
    url: `https://aeon.test${path}`,
    headers: { get: () => authorization ?? null },
  } as unknown as Parameters<typeof GET>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CRON_SECRET
  delete process.env.KAIROS_OPERATOR_USER_ID
  ;(process.env as Record<string, string>).NODE_ENV = 'test'
  vi.mocked(embeddingsEnabled).mockReturnValue(true)
})

describe('cron/embed-backfill route', () => {
  it('rejects without the configured bearer secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(backfillEmbeddings).not.toHaveBeenCalled()
  })

  it('no-ops when embeddings are disabled', async () => {
    vi.mocked(embeddingsEnabled).mockReturnValue(false)
    const response = await GET(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.error).toBe('embeddings_disabled')
    expect(backfillEmbeddings).not.toHaveBeenCalled()
  })

  it('traces an uncaught exception to KAIROS_OPERATOR_USER_ID and still 500s', async () => {
    process.env.KAIROS_OPERATOR_USER_ID = OPERATOR
    vi.mocked(backfillEmbeddings).mockRejectedValue(new Error('provider timeout'))

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('provider timeout')
    expect(writeCronFailureTrace).toHaveBeenCalledWith(OPERATOR, expect.objectContaining({
      cronName: 'embed-backfill',
      reason: 'uncaught_exception',
    }))
  })

  it('skips the trace write gracefully when KAIROS_OPERATOR_USER_ID is unset', async () => {
    vi.mocked(backfillEmbeddings).mockRejectedValue(new Error('provider timeout'))

    const response = await GET(request())

    expect(response.status).toBe(500)
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })

  it('returns the backfill result on success', async () => {
    vi.mocked(backfillEmbeddings).mockResolvedValue({ embedded: 12, remaining: 0 } as never)

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ embedded: 12, remaining: 0, model: 'voyage-3' })
    expect(writeCronFailureTrace).not.toHaveBeenCalled()
  })
})
