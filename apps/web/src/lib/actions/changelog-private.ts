'use server'

import { auth } from '@/lib/auth'
import { PRIVATE_CHANGELOG_MD, PRIVATE_CHANGELOG_VERSION } from '@/lib/changelog-private'
import { canUseVorath } from '@/lib/vorath-access'

export type PrivateChangelog = { version: string; markdown: string }

/** The owner-only Vorath changelog, or null for everyone else (no hint that it exists). */
export async function getPrivateChangelog(): Promise<PrivateChangelog | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId || !canUseVorath(userId)) return null
  return { version: PRIVATE_CHANGELOG_VERSION, markdown: PRIVATE_CHANGELOG_MD }
}
