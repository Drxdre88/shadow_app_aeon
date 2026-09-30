import { z } from 'zod'

// Canonical session record v1 — one flat shape for "an agent worked on
// something", stored at memories.sourceMetadata.session. Written by the Hangar
// events route (mission envelope) AND by the .mjs session-capture scripts
// (Claude / Codex / Copilot hooks), so KEY NAMES ARE A CROSS-LANGUAGE
// CONTRACT — rename nothing without updating the capture scripts.
// Design: research/kairos_2909/03_capture_and_recency.md §C "One session record".
//
// Only v, client and sessionId are required. The schema is non-strict so a
// newer writer can add keys without a reader rejecting the whole record.

export const SESSION_RECORD_VERSION = 1 as const
export const SESSION_RECORD_FIRST_PROMPT_MAX = 500
export const SESSION_RECORD_FILES_MAX = 50

export const sessionRecordStatusSchema = z.enum(['completed', 'needs_input', 'failed', 'abandoned'])

const nonNegInt = z.number().int().min(0)
const nonNeg = z.number().finite().min(0)

export const sessionRecordV1Schema = z.object({
  v:               z.literal(SESSION_RECORD_VERSION),
  client:          z.string().min(1).max(40),
  sessionId:       z.string().min(1).max(200),
  hangarSessionId: z.string().optional(),
  taskId:          z.string().optional(),
  projectId:       z.string().optional(),
  repo:            z.string().optional(),
  registrySlug:    z.string().optional(),
  worktree:        z.boolean().optional(),
  startedAt:       z.string().optional(),
  endedAt:         z.string().optional(),
  durationMin:     nonNeg.optional(),
  firstPrompt:     z.string().max(SESSION_RECORD_FIRST_PROMPT_MAX).optional(),
  objective:       z.string().optional(),
  cardName:        z.string().optional(),
  status:          sessionRecordStatusSchema.optional(),
  outcome:         z.string().optional(),
  questions:       z.array(z.string()).optional(),
  branch:          z.string().optional(),
  // subject is optional: the Hangar envelope carries a bare sha only.
  commits:         z.array(z.object({ sha: z.string(), subject: z.string().optional() })).optional(),
  prs:             z.array(z.object({
    number: nonNegInt.optional(),
    url:    z.string(),
    action: z.string().optional(),
  })).optional(),
  tests:           z.object({ status: z.string(), summary: z.string().optional() }).optional(),
  model:           z.string().optional(),
  inputTokens:     nonNegInt.optional(),
  outputTokens:    nonNegInt.optional(),
  cacheReadTokens: nonNegInt.optional(),
  costUsd:         nonNeg.optional(),
  linesAdded:      nonNegInt.optional(),
  linesRemoved:    nonNegInt.optional(),
  // Tool-name histogram. A writer that only knows the total (Hangar envelope
  // stats.toolCalls) records it under the key 'total'.
  toolCalls:       z.record(z.string(), nonNegInt).optional(),
  errorCount:      nonNegInt.optional(),
  files:           z.array(z.string()).max(SESSION_RECORD_FILES_MAX).optional(),
})

export type SessionRecordV1 = z.infer<typeof sessionRecordV1Schema>
export type SessionRecordStatus = z.infer<typeof sessionRecordStatusSchema>

export type SessionRecordInput = Omit<SessionRecordV1, 'v'>

/**
 * Build a v1 record: stamps `v`, applies the length caps (firstPrompt ≤500,
 * files ≤50) instead of rejecting, and drops undefined / empty-array keys so
 * the stored jsonb stays compact.
 */
export function buildSessionRecord(input: SessionRecordInput): SessionRecordV1 {
  const record: Record<string, unknown> = { v: SESSION_RECORD_VERSION }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value) && value.length === 0) continue
    record[key] = value
  }
  if (typeof record.firstPrompt === 'string') {
    record.firstPrompt = (record.firstPrompt as string).slice(0, SESSION_RECORD_FIRST_PROMPT_MAX)
  }
  if (Array.isArray(record.files)) {
    record.files = (record.files as string[]).slice(0, SESSION_RECORD_FILES_MAX)
  }
  return sessionRecordV1Schema.parse(record)
}
