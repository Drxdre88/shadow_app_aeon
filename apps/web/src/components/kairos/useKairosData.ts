'use client'

import { useEffect, useState, useCallback } from 'react'
import { getBrainGraph } from '@/lib/actions/memories'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'
import { useKairosStore } from '@/stores/kairosStore'

export type KairosGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export function useKairosData(realmId?: string) {
  const [graph, setGraph] = useState<KairosGraph>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const refreshSignal = useKairosStore((s) => s.refreshSignal)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await getBrainGraph({ realmId })
      setGraph(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Kairos')
    } finally {
      setLoading(false)
    }
  }, [realmId])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh, refreshSignal])

  return { graph, loading, error, refresh }
}
