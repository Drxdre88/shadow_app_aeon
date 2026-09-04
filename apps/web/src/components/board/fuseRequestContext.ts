'use client'

import { createContext, useContext } from 'react'

export type RequestFuse = (targetId: string, sourceIds: string[]) => void

/**
 * How a card's context menu, rendered deep inside a column, reaches the
 * board-level fusion lifecycle (useFuseCards). Its own module so the menu
 * never imports the server action the lifecycle calls. null outside a
 * board — Zen copies still sit under the board's provider.
 */
export const FuseRequestContext = createContext<RequestFuse | null>(null)

export function useFuseRequest(): RequestFuse | null {
  return useContext(FuseRequestContext)
}
