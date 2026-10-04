'use client'

import type { ComponentType } from 'react'
import { OwnerCarryingCard } from './OwnerCarryingCard'

// Wave 4 inbox slot: lane cards render here, above the inbox list. Each card
// renders nothing while its flag is off.
const INBOX_EXTRAS: ReadonlyArray<{ key: string; Component: ComponentType }> = [
  { key: 'owner-carrying', Component: OwnerCarryingCard },
]

export function InboxExtras() {
  if (INBOX_EXTRAS.length === 0) return null
  return (
    <>
      {INBOX_EXTRAS.map(({ key, Component }) => <Component key={key} />)}
    </>
  )
}
