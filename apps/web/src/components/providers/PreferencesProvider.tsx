'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useThemeStore } from '@/stores/themeStore'
import { getPreferences, savePreferences } from '@/lib/actions/preferences'

const DEBOUNCE_MS = 1500
const LOCAL_STORAGE_KEY = 'aeon-theme'

function extractPrefsFromState(state: Record<string, unknown>) {
  const { _hydrated, _hydrateFromDB, colors, businessMode: _bm, _businessSnapshot: _bs, ...actions } = state
  const prefs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(actions)) {
    if (typeof value !== 'function') {
      prefs[key] = value
    }
  }
  return prefs
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const isHydratingRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const debouncedSave = useCallback((prefs: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      savePreferences(prefs).catch(() => {})
    }, DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return

    let cancelled = false

    async function hydrate() {
      try {
        let migratedLocal: Record<string, unknown> | null = null
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
          if (raw) {
            const parsed = JSON.parse(raw)
            migratedLocal = parsed?.state ?? null
            localStorage.removeItem(LOCAL_STORAGE_KEY)
          }
        } catch {}

        const dbPrefs = await getPreferences()
        if (cancelled) return

        const merged = migratedLocal
          ? { ...dbPrefs, ...migratedLocal }
          : dbPrefs

        useThemeStore.getState()._hydrateFromDB(merged)

        if (migratedLocal) {
          const prefs = extractPrefsFromState(useThemeStore.getState() as unknown as Record<string, unknown>)
          await savePreferences(prefs).catch(() => {})
        }
      } finally {
        if (!cancelled) {
          isHydratingRef.current = false
        }
      }
    }

    hydrate()
    return () => { cancelled = true }
  }, [status, session?.user?.id])

  useEffect(() => {
    if (status !== 'authenticated') return

    const unsub = useThemeStore.subscribe(() => {
      if (isHydratingRef.current) return
      const prefs = extractPrefsFromState(useThemeStore.getState() as unknown as Record<string, unknown>)
      debouncedSave(prefs)
    })

    return () => {
      unsub()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status, debouncedSave])

  useEffect(() => {
    if (status !== 'unauthenticated') return
    const timer = setTimeout(() => {
      if (!useThemeStore.getState()._hydrated) {
        useThemeStore.getState()._hydrateFromDB({})
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [status])

  return <>{children}</>
}
