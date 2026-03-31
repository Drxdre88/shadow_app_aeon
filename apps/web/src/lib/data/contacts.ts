import { db } from '@/lib/db'
import { userContacts, users } from '@/lib/db/schema'
import { eq, and, or, ilike, sql } from 'drizzle-orm'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&')
}

export async function upsertContact(
  userId: string,
  contactEmail: string,
  displayName?: string | null,
) {
  const normalized = contactEmail.trim().toLowerCase()
  if (!EMAIL_RE.test(normalized) || normalized.length > 255) {
    throw new Error('Invalid email')
  }
  if (displayName && displayName.length > 255) {
    throw new Error('Display name too long')
  }

  const [matchedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))

  const [contact] = await db
    .insert(userContacts)
    .values({
      userId,
      contactEmail: normalized,
      contactUserId: matchedUser?.id ?? null,
      displayName: displayName ?? null,
    })
    .onConflictDoUpdate({
      target: [userContacts.userId, userContacts.contactEmail],
      set: {
        ...(displayName !== undefined ? { displayName: displayName ?? null } : {}),
        ...(matchedUser?.id ? { contactUserId: matchedUser.id } : {}),
      },
    })
    .returning({ id: userContacts.id })

  return contact
}

export async function removeContact(userId: string, contactId: string) {
  await db
    .delete(userContacts)
    .where(and(eq(userContacts.id, contactId), eq(userContacts.userId, userId)))
}

export async function searchContacts(userId: string, query: string, limit = 10) {
  const escaped = escapeLike(query.trim())
  const pattern = `%${escaped}%`

  return db
    .select({
      id: userContacts.id,
      contactEmail: userContacts.contactEmail,
      contactUserId: userContacts.contactUserId,
      displayName: userContacts.displayName,
      userName: users.name,
      userImage: users.image,
    })
    .from(userContacts)
    .leftJoin(users, eq(users.id, userContacts.contactUserId))
    .where(
      and(
        eq(userContacts.userId, userId),
        or(
          sql`${userContacts.contactEmail} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${userContacts.displayName} ILIKE ${pattern} ESCAPE '\\'`,
          sql`${users.name} ILIKE ${pattern} ESCAPE '\\'`,
        ),
      ),
    )
    .orderBy(sql`coalesce(${userContacts.displayName}, ${users.name}, ${userContacts.contactEmail})`)
    .limit(limit)
}

export async function listContacts(userId: string) {
  return db
    .select({
      id: userContacts.id,
      contactEmail: userContacts.contactEmail,
      contactUserId: userContacts.contactUserId,
      displayName: userContacts.displayName,
      userName: users.name,
      userImage: users.image,
    })
    .from(userContacts)
    .leftJoin(users, eq(users.id, userContacts.contactUserId))
    .where(eq(userContacts.userId, userId))
    .orderBy(sql`coalesce(${userContacts.displayName}, ${users.name}, ${userContacts.contactEmail})`)
    .limit(50)
}
