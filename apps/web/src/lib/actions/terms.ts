'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function acceptBetaTerms() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(users)
    .set({ termsAcceptedAt: new Date() })
    .where(eq(users.id, session.user.id))

  return { success: true }
}
