import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rerank, rerankEnabled } from '../rerank'

// Voyage rerank — cross-encoder precision pass. Best-effort: no key or API
// error must return null so the caller keeps its prior order (never drops it).

const items = [
  { id: 'a', text: 'alpha' },
  { id: 'b', text: 'bravo' },
  { id: 'c', text: 'charlie' },
]

function mockRerankResponse(data: Array<{ index: number; relevance_score: number }>) {
  return {
    ok: true,
    json: async () => ({ data }),
    text: async () => '',
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('rerank', () => {
  beforeEach(() => {
    vi.stubEnv('VOYAGE_API_KEY', 'test-key')
  })

  it('reorders items by descending relevance and maps indices back', async () => {
    // Voyage says doc index 2 (charlie) is most relevant, then 0, then 1.
    const fetchMock = vi.fn().mockResolvedValue(
      mockRerankResponse([
        { index: 1, relevance_score: 0.1 },
        { index: 2, relevance_score: 0.9 },
        { index: 0, relevance_score: 0.5 },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)

    const out = await rerank('query', items, (i) => i.text)

    expect(out?.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    // Sanity: it hit the rerank endpoint with the right model + docs.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.voyageai.com/v1/rerank')
    expect(body.model).toBe('rerank-2.5')
    expect(body.documents).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('forwards top_k when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockRerankResponse([{ index: 0, relevance_score: 0.9 }]),
    )
    vi.stubGlobal('fetch', fetchMock)

    await rerank('query', items, (i) => i.text, { topK: 1 })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.top_k).toBe(1)
  })

  it('returns null (keep prior order) on API error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response),
    )
    const out = await rerank('query', items, (i) => i.text)
    expect(out).toBeNull()
  })

  it('returns null without a Voyage key and never calls fetch', async () => {
    vi.stubEnv('VOYAGE_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(rerankEnabled()).toBe(false)
    expect(await rerank('query', items, (i) => i.text)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for empty input or blank query without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await rerank('query', [], (i: { text: string }) => i.text)).toBeNull()
    expect(await rerank('   ', items, (i) => i.text)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
