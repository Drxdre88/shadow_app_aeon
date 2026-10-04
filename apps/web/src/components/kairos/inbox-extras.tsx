'use client'

import type { ComponentType } from 'react'

// Wave 4 inbox slot: lane cards (e.g. the owner-model "carrying" card) render
// here, above the inbox list. Empty by default — renders nothing.
const INBOX_EXTRAS: ReadonlyArray<{ key: string; Component: ComponentType }> = []

export function InboxExtras() {
  if (INBOX_EXTRAS.length === 0) return null
  return (
    <>
      {INBOX_EXTRAS.map(({ key, Component }) => <Component key={key} />)}
    </>
  )
}
