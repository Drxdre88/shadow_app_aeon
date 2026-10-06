import { z } from 'zod'

// Mission check ("Vorath checks finished missions"): an advisory verdict on a
// finished Hangar mission, judged only from what the mission reported against
// the card's checklist and description. Stored on metadata.hangar.check; it
// never moves, blocks, merges or creates a card.

export const MISSION_CHECK_KIND = 'mission_check' as const
// projects.settings key; only boolean true counts. Changed only by the owner-only switch.
export const MISSION_CHECK_SETTING = 'kairosMissionCheck' as const

export const MISSION_VERDICTS = ['looks_done', 'partly_done', 'not_done'] as const
export type MissionVerdict = (typeof MISSION_VERDICTS)[number]

export const MISSION_CHECK_MODES = ['observe', 'on'] as const
export type MissionCheckStoredMode = (typeof MISSION_CHECK_MODES)[number]

export const CHECK_MAX_REASONS = 4
export const CHECK_MAX_UNMET = 10
export const CHECK_REASON_MAX = 200
export const CHECK_NOTE_MAX = 240
export const CHECK_UNMET_MAX = 200

export const missionCheckSchema = z.object({
  sessionId: z.string().min(1),
  verdict: z.enum(MISSION_VERDICTS),
  reasons: z.array(z.string()).max(CHECK_MAX_REASONS).default([]),
  unmet: z.array(z.string()).max(CHECK_MAX_UNMET).default([]),
  note: z.string().default(''),
  checkedAt: z.string().min(1),
  mode: z.enum(MISSION_CHECK_MODES),
})
export type MissionCheck = z.infer<typeof missionCheckSchema>

// What the model must answer: unmet items are checklist handles (C1, C2…).
export const missionCheckAnswerSchema = z.object({
  verdict: z.enum(MISSION_VERDICTS),
  reasons: z.array(z.string()).max(20).default([]),
  unmet: z.array(z.string()).max(50).default([]),
  note: z.string().default(''),
})
export type MissionCheckAnswer = z.infer<typeof missionCheckAnswerSchema>

export const setMissionCheckInputSchema = z.object({ on: z.boolean() })

export const VERDICT_LABELS: Record<MissionVerdict, string> = {
  looks_done: 'Looks done',
  partly_done: 'Partly done',
  not_done: 'Not done',
}

export function isMissionCheckOn(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false
  return (settings as Record<string, unknown>)[MISSION_CHECK_SETTING] === true
}

function lastSessionId(hangar: Record<string, unknown>): string | null {
  const ids = hangar.sessionIds
  if (!Array.isArray(ids) || ids.length === 0) return null
  const last = ids[ids.length - 1]
  return typeof last === 'string' ? last : null
}

/**
 * The verdict to show for a card's raw hangar metadata: only a mode-'on'
 * check about the card's latest mission. Observe-mode, stale or malformed
 * checks read as null.
 */
export function readVisibleMissionCheck(hangar: unknown): MissionCheck | null {
  if (!hangar || typeof hangar !== 'object' || Array.isArray(hangar)) return null
  const raw = hangar as Record<string, unknown>
  const parsed = missionCheckSchema.safeParse(raw.check)
  if (!parsed.success || parsed.data.mode !== 'on') return null
  return lastSessionId(raw) === parsed.data.sessionId ? parsed.data : null
}
