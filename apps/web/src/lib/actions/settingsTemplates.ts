'use server'

import { auth } from '@/lib/auth'
import {
  BUSINESS_ADMIN_TEMPLATE,
  BUSINESS_ADMIN_FALLBACK,
  findTemplate,
  upsertTemplate,
} from '@/lib/data/settingsTemplates'

async function requireAdmin() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  if (session.user.role !== 'admin') throw new Error('Admin access required')
  return session.user.id
}

export async function getSettingsTemplate(name: string = BUSINESS_ADMIN_TEMPLATE) {
  await requireAdmin()
  const row = await findTemplate(name)
  return {
    name,
    exists: !!row,
    preferences: (row?.preferences as Record<string, unknown>) ?? BUSINESS_ADMIN_FALLBACK,
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function saveSettingsTemplate(name: string, preferences: Record<string, unknown>) {
  const userId = await requireAdmin()
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > 50) throw new Error('Template name must be 1-50 characters')
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error('Template preferences must be an object')
  }
  await upsertTemplate(trimmed, preferences, userId)
  return { ok: true as const }
}
