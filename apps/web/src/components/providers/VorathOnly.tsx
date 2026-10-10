'use client'

import type { ReactNode } from 'react'
import { useVorath } from '@/hooks/useVorath'

/** Renders children only for the Vorath owner; nothing at all for anyone else. */
export function VorathOnly({ children }: { children: ReactNode }) {
  return useVorath() ? <>{children}</> : null
}
