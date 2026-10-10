'use client'

import { useContext } from 'react'
import { SessionContext } from 'next-auth/react'

/** True only for the owner allowlisted for Vorath; false while loading, signed out, or outside a SessionProvider. */
export function useVorath(): boolean {
  const ctx = useContext(SessionContext)
  return ctx?.data?.user?.vorath === true
}
