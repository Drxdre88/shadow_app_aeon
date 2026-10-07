'use client'

import { create } from 'zustand'
import { useBoardStore } from '@/lib/store/boardStore'
import type { CardForecast } from '@/lib/schedule/forecast'

// Per-board card forecasts keyed by taskId (P3-2). Badges acquire the board
// they render on; the first acquire loads it, the store refreshes every 5
// minutes while the tab is visible and shortly after the board's tasks are
// replaced (a reload), and the last release stops all of that.

export const FORECAST_REFRESH_MS = 5 * 60_000
const BOARD_CHANGE_MIN_GAP_MS = 30_000
const BOARD_CHANGE_DEBOUNCE_MS = 2_000
// The /demo board runs on a fake id with no server behind it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Loader = (projectId: string) => Promise<{ forecasts: CardForecast[] }>
// Loaded lazily so every card importing the badge does not pull the auth chain in at module load.

interface ForecastState {
  projectId: string | null
  byTaskId: Record<string, CardForecast>
  loadedAt: number
  inFlight: boolean
  holders: number
  load: (projectId: string) => Promise<void>
  acquire: (projectId: string) => () => void
}

interface Watch {
  interval: ReturnType<typeof setInterval>
  debounce: ReturnType<typeof setTimeout> | null
  unsubscribe: () => void
}

export function createForecastStore(loader: Loader = (id) => import('@/lib/actions/card-forecast').then((m) => m.getCardForecasts(id))) {
  let watch: Watch | null = null

  const store = create<ForecastState>()((set, get) => {
    const refreshIfVisible = () => {
      const { projectId } = get()
      if (!projectId) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void get().load(projectId)
    }

    const startWatch = () => {
      const interval = setInterval(refreshIfVisible, FORECAST_REFRESH_MS)
      const w: Watch = { interval, debounce: null, unsubscribe: () => {} }
      w.unsubscribe = useBoardStore.subscribe((s, prev) => {
        if (s.tasks === prev.tasks) return
        if (Date.now() - get().loadedAt < BOARD_CHANGE_MIN_GAP_MS) return
        if (w.debounce) clearTimeout(w.debounce)
        w.debounce = setTimeout(refreshIfVisible, BOARD_CHANGE_DEBOUNCE_MS)
      })
      watch = w
    }

    const stopWatch = () => {
      if (!watch) return
      clearInterval(watch.interval)
      if (watch.debounce) clearTimeout(watch.debounce)
      watch.unsubscribe()
      watch = null
    }

    return {
      projectId: null,
      byTaskId: {},
      loadedAt: 0,
      inFlight: false,
      holders: 0,

      load: async (projectId) => {
        if (get().inFlight && get().projectId === projectId) return
        set({ inFlight: true, projectId })
        try {
          const { forecasts } = await loader(projectId)
          if (get().projectId !== projectId) return
          const byTaskId: Record<string, CardForecast> = {}
          for (const f of forecasts) byTaskId[f.taskId] = f
          set({ byTaskId, loadedAt: Date.now() })
        } catch (err) {
          console.error('Failed to load card forecasts:', err)
        } finally {
          if (get().projectId === projectId) set({ inFlight: false })
        }
      },

      acquire: (projectId) => {
        if (!UUID_RE.test(projectId)) return () => {}
        const switched = get().projectId !== projectId
        if (switched) set({ projectId, byTaskId: {}, loadedAt: 0, inFlight: false })
        if (switched || get().holders === 0 || get().loadedAt === 0) void get().load(projectId)
        set({ holders: get().holders + 1 })
        if (!watch) startWatch()
        let released = false
        return () => {
          if (released) return
          released = true
          const holders = Math.max(0, get().holders - 1)
          set({ holders })
          if (holders === 0) stopWatch()
        }
      },
    }
  })

  return store
}

export const useForecastStore = createForecastStore()
