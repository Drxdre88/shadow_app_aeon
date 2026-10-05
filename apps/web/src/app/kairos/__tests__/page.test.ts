import { describe, it, expect, vi, beforeEach } from 'vitest'

const permanentRedirect = vi.fn()
vi.mock('next/navigation', () => ({ permanentRedirect: (url: string) => permanentRedirect(url) }))

import KairosRedirect from '../page'

beforeEach(() => permanentRedirect.mockClear())

describe('/kairos', () => {
  it('permanently redirects to /vorath', async () => {
    await KairosRedirect({ searchParams: Promise.resolve({}) })
    expect(permanentRedirect).toHaveBeenCalledWith('/vorath')
  })

  it('keeps the query string', async () => {
    await KairosRedirect({ searchParams: Promise.resolve({ memory: 'm1', tag: ['a', 'b'] }) })
    expect(permanentRedirect).toHaveBeenCalledWith('/vorath?memory=m1&tag=a&tag=b')
  })
})
