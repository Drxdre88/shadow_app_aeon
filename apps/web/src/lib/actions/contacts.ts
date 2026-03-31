'use server'

import { auth } from '@/lib/auth'
import {
  upsertContact as _upsert,
  removeContact as _remove,
  searchContacts as _search,
  listContacts as _list,
} from '@/lib/data/contacts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}

function validateEmail(email: string): string {
  const trimmed = email.trim().toLowerCase()
  if (!trimmed || trimmed.length > 255 || !EMAIL_RE.test(trimmed)) {
    throw new Error('Invalid email')
  }
  return trimmed
}

export async function addContact(email: string, displayName?: string) {
  const userId = await requireAuth()
  const validated = validateEmail(email)
  if (displayName && displayName.length > 255) throw new Error('Display name too long')
  return _upsert(userId, validated, displayName)
}

export async function removeContact(contactId: string) {
  const userId = await requireAuth()
  return _remove(userId, contactId)
}

export async function searchContacts(query: string) {
  const userId = await requireAuth()
  const trimmed = (query ?? '').trim()
  if (!trimmed) return _list(userId)
  if (trimmed.length > 255) return []
  return _search(userId, trimmed)
}

export async function autoSaveContact(email: string, displayName?: string) {
  const userId = await requireAuth()
  const validated = validateEmail(email)
  if (displayName && displayName.length > 255) return
  return _upsert(userId, validated, displayName)
}
