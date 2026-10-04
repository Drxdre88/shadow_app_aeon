'use client'

import type { ComponentType } from 'react'
import { OwnerCarryingCard } from './OwnerCarryingCard'

// Wave 4 inbox slot: lane cards render here, above the inbox list. Each card
// renders nothing while its flag is off. Flags come from the inbox payload,
// so a card whose flag is off never calls the server.
export interface InboxExtrasProps {
  ownerModelEnabled: boolean
}

const INBOX_EXTRAS: ReadonlyArray<{ key: string; Component: ComponentType<InboxExtrasProps> }> = [
  { key: 'owner-carrying', Component: OwnerCarryingCard },
]

export function InboxExtras(props: InboxExtrasProps) {
  if (INBOX_EXTRAS.length === 0) return null
  return (
    <>
      {INBOX_EXTRAS.map(({ key, Component }) => <Component key={key} {...props} />)}
    </>
  )
}
