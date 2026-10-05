'use server'

import { revalidatePath } from 'next/cache'
import { requireEditor, requireOwner } from './helpers'
import { hangarCardDraftSchema } from '@/lib/data/validators'
import { findTaskById, updateTask } from '@/lib/data/tasks'
import { listHangarRepos } from '@/lib/data/hangar-repos'
import { findProjectRealmIds } from '@/lib/data/workspaces'
import { mergeProjectSettings } from '@/lib/data/projects'
import { findColumns } from '@/lib/data/columns'
import { z } from 'zod'
import { launchCardMission } from './hangar-launch'

// AI Hangar card actions: launch, mission editing and board-level config.
// The launch path itself lives in ./hangar-launch; autopilot verbs (requeue,
// plan approval, answers, follow-ups) live in ./hangar-autopilot.

/**
 * @param origin 'manual' = the operator explicitly hit Execute / Save &
 * Launch. 'auto-drop' = a column move fired it, which is only legitimate
 * while the card is armed IN THE DATABASE — the client's copy of `autoRun`
 * can be stale (a launch disarms the card, and that write reaches the board
 * asynchronously), so an auto-drop must re-check the stored value or a stale
 * card could launch a second agent after its first mission finished.
 */
export async function spawnSessionFromCard(
  projectId: string,
  taskId: string,
  origin: 'manual' | 'auto-drop' = 'manual'
) {
  return launchCardMission(projectId, taskId, origin, null)
}

/**
 * Repos the mission editor can offer for this board: the union of every
 * realm registry the project belongs to (active entries only).
 */
export async function listProjectHangarRepos(projectId: string) {
  await requireEditor(projectId)
  const realmIds = await findProjectRealmIds(projectId)
  const registries = await Promise.all(realmIds.map((id) => listHangarRepos(id)))
  const bySlug = new Map<string, { slug: string; name: string; allowedEngines: string[] }>()
  for (const repo of registries.flat()) {
    if (!repo.active) continue
    const existing = bySlug.get(repo.slug)
    if (existing) {
      // Divergent realm configs must not hide an engine one realm permits.
      existing.allowedEngines = [...new Set([...existing.allowedEngines, ...repo.allowedEngines])]
    } else {
      bySlug.set(repo.slug, { slug: repo.slug, name: repo.name, allowedEngines: [...repo.allowedEngines] })
    }
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

/** Write a card's mission payload (metadata.hangar) without touching the rest. */
export async function saveCardMission(
  projectId: string,
  taskId: string,
  draft: z.input<typeof hangarCardDraftSchema>
) {
  await requireEditor(projectId)
  const task = await findTaskById(taskId, projectId)
  if (!task) throw new Error('Task not found or unauthorized')

  const parsed = hangarCardDraftSchema.parse(draft)
  const existing = ((task.metadata ?? {}) as Record<string, unknown>).hangar
  const preserved = (existing && typeof existing === 'object' && !Array.isArray(existing))
    ? existing as Record<string, unknown>
    : {}

  // sessionIds / lastResult are system-written — never clobbered by an edit.
  await updateTask(taskId, projectId, {
    metadata: { hangar: { ...preserved, ...parsed } },
  })

  revalidatePath(`/project/${projectId}`)
  return parsed
}

/**
 * Columns for the launch-column picker. The dashboard renders the project
 * editor without ever hydrating the board store, so reading columns from the
 * client store there yields an empty list.
 */
export async function listProjectColumnsForHangar(projectId: string) {
  await requireEditor(projectId)
  const columns = await findColumns(projectId)
  return columns
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => ({ id: c.id, name: c.name }))
}

const hangarSettingsSchema = z.object({
  enabled: z.boolean(),
  triggerColumnId: z.string().uuid().nullable(),
})

/**
 * Board-level Auto AI config, stored under projects.settings.hangar.
 *
 * Ownership, not editor: this switch decides whether dropping a card can put
 * an autonomous agent on a repo, which is a different order of privilege from
 * editing cards.
 */
export async function setHangarBoardSettings(
  projectId: string,
  input: { enabled: boolean; triggerColumnId: string | null }
) {
  await requireOwner(projectId)
  const parsed = hangarSettingsSchema.parse(input)

  // A trigger column from another board would sit in settings looking armed
  // while never matching a drop — silently inert config is worse than none.
  let triggerColumnId = parsed.triggerColumnId
  if (triggerColumnId) {
    const columns = await findColumns(projectId)
    if (!columns.some((c) => c.id === triggerColumnId)) triggerColumnId = null
  }

  const config = { ...parsed, triggerColumnId }
  // SQL merge: settings is one shared jsonb column (board theme, sizing, …),
  // so a read-modify-write here would revert a concurrent save.
  await mergeProjectSettings(projectId, { hangar: config })
  revalidatePath(`/project/${projectId}`)
  return config
}
