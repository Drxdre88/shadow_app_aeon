'use client'

import { useEffect, useState, useCallback } from 'react'
import { getAetherAction } from '@/lib/actions/aether'
import type { AetherPayload } from '@/lib/kairos/aether-types'

export function useAetherData() {
  const [payload, setPayload] = useState<AetherPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await getAetherAction()
      setPayload(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Aether')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  return { payload, loading, error, refresh }
}
