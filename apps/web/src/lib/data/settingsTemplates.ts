import { db } from '@/lib/db'
import { settingsTemplates, userPreferences } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const BUSINESS_ADMIN_TEMPLATE = 'business_admin'

// Applied to every brand-new account when no settings_templates row exists yet.
// Values must be valid keys of DEFAULT_PREFERENCES (plus businessMode, which
// lives in themeStore and rides through the preferences passthrough).
export const BUSINESS_ADMIN_FALLBACK: Record<string, unknown> = {
  businessMode: true,
  celebrationStyle: 'checkmark-pulse',
  dragEffect: 'ghost',
  cursorEffect: 'none',
  ambientBlobs: false,
  glowIntensity: 20,
  glassOpacity: 30,
  surfaceVibrancy: 0,
}

export async function findTemplate(name: string) {
  return db
    .select()
    .from(settingsTemplates)
    .where(eq(settingsTemplates.name, name))
    .then((rows) => rows[0] ?? null)
}

export async function listTemplates() {
  return db.select().from(settingsTemplates)
}

export async function upsertTemplate(name: string, preferences: Record<string, unknown>, userId: string) {
  await db
    .insert(settingsTemplates)
    .values({ name, preferences, createdBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settingsTemplates.name,
      set: { preferences, updatedAt: new Date() },
    })
}

/** Stamps the business_admin template (or its fallback) onto a fresh account. */
export async function applyDefaultTemplateToUser(userId: string) {
  const template = await findTemplate(BUSINESS_ADMIN_TEMPLATE)
  const preferences = (template?.preferences as Record<string, unknown> | undefined) ?? BUSINESS_ADMIN_FALLBACK

  await db
    .insert(userPreferences)
    .values({ userId, preferences, updatedAt: new Date() })
    .onConflictDoNothing({ target: userPreferences.userId })
}
