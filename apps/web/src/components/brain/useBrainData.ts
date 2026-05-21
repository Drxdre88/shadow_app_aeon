'use client'

import { useEffect, useState, useCallback } from 'react'
import { getBrainGraph } from '@/lib/actions/memories'
import type { GraphNode, GraphEdge } from '@/lib/data/memories'

export type BrainGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

export function useBrainData(realmId?: string) {
  const [graph, setGraph] = useState<BrainGraph>({ nodes: [], edges: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await getBrainGraph({ realmId })
      setGraph(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load brain')
    } finally {
      setLoading(false)
    }
  }, [realmId])

  useEffect(() => {
    setLoading(true)
    refresh()
  }, [refresh])

  return { graph, loading, error, refresh }
}
