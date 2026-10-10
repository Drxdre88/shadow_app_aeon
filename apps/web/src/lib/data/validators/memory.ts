import { z } from 'zod'
import { MIND_NAME } from '@/lib/kairos/identity'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 1 — memory validators. See docs/brain/02-mcp-tools.md.
// Shared verbatim by REST routes and MCP tools (locked by memories-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

// Kairos Phase 1 (A1) — taxonomy expansion. Substrate carries everything
// Kairos hears, not just Claude sessions. Added types: snapshot, inbound,
// advisory, achievement, session_event, fact, contact, external_event.
export const memoryTypeSchema   = z.enum([
  'note',
  'decision',
  'idea',
  'observation',
  'session_summary',
  'reflection',
  'snapshot',
  'inbound',
  'advisory',
  'achievement',
  'session_event',
  'fact',
  'contact',
  'external_event',
  // Kairos Phase 2 (B1) — synthesised master node per Dominion (3-7 per run).
  'archetype',
  // Kairos Phase 2 (B2) — living document per Dominion (one per Dominion).
  'dominion_cortex',
  // Aether — daily cross-Dominion synthesis (one per UTC day).
  'aether',
  // Memory engine (docs/kairos/32) — distilled cluster of member memories.
  'concept',
  // P2 (docs/kairos/34) — one claim in the aligned or own mind.
  'belief',
  // P2 (docs/kairos/34) — the operator's reasons-based principles, one live version.
  'constitution',
])
// Kairos Phase 1 (A1) — added sources: 'cron' (briefer/snapshot jobs),
// 'system' (board mutations, project lifecycle), 'webhook' (channel adapters).
export const memorySourceSchema = z.enum(['manual', 'claude', 'codex', 'copilot', 'voice', 'hook', 'import', 'cron', 'system', 'webhook'])
// 'resolves' — incident lifecycle: a memory carrying this link closes its
// target's valid window (invalidAt stamped by createMemory, lib/data/memories.ts).
export const memoryEdgeTypeSchema   = z.enum(['relates', 'supports', 'contradicts', 'supersedes', 'refers_to', 'blocks_thinking', 'resolves'])
export const memoryTargetKindSchema = z.enum(['memory', 'task', 'project', 'realm', 'url'])

export const memoryLinkSchema = z.object({
  type: memoryEdgeTypeSchema,
  target: z.string().min(1).max(2048),         // uuid for non-url kinds, URL string for url
  target_kind: memoryTargetKindSchema,
  note: z.string().trim().max(500).optional(),
})

// Phase 2 goals: only the goal_propose handler mints goal rows (directly in
// the data layer), so a create/capture payload may never claim to be one.
export const GOAL_METADATA_REFUSAL = `sourceMetadata may not describe a ${MIND_NAME} goal`
// Rows only Kairos's own jobs mint (voice samples, cold reads, character runs):
// a create/capture payload may never claim to be one, or an agent could forge
// an "approved" voice sample or a measurement.
export const INTERNAL_KIND_REFUSAL = `sourceMetadata may not describe an internal ${MIND_NAME} record`
const INTERNAL_KINDS: readonly string[] = ['voice_sample', 'cold_read', 'character_run', 'life_chapter', 'repo_playbook', 'card_tree', 'card_garden']
const memorySourceMetadataSchema = z.record(z.string(), z.unknown()).refine(
  (m) => m.kind !== 'goal' && !Object.prototype.hasOwnProperty.call(m, 'goal'),
  { message: GOAL_METADATA_REFUSAL },
).refine(
  (m) => typeof m.kind !== 'string' || !INTERNAL_KINDS.includes(m.kind),
  { message: INTERNAL_KIND_REFUSAL },
)

export const createMemorySchema = z.object({
  title:           z.string().trim().min(1).max(255),
  // AI-cleaned short title (1–6 words). Optional — caller supplies if it has
  // already done the cleanup pass (e.g. Claude Code post-voice-dump).
  aiTitle:         z.string().trim().min(1).max(120).nullable().optional(),
  bodyMd:          z.string().min(1).max(100_000),
  summary:         z.string().trim().max(1000).optional(),
  // 5–10 cleaned bullet points. Front-of-house in the UI. Optional — caller
  // supplies after self-prompting on the bodyMd.
  execSummary:     z.array(z.string().trim().min(1).max(500)).max(15).optional(),
  type:            memoryTypeSchema.default('note'),
  source:          memorySourceSchema.default('manual'),
  sourceMetadata:  memorySourceMetadataSchema.optional(),
  realmId:         z.string().uuid().nullable().optional(),
  projectId:       z.string().uuid().nullable().optional(),
  taskId:          z.string().uuid().nullable().optional(),
  dominionId:      z.string().uuid().nullable().optional(),
  tags:            z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  links:           z.array(memoryLinkSchema).max(100).optional(),
  pinned:          z.boolean().optional(),
})

export const updateMemorySchema = z.object({
  title:           z.string().trim().min(1).max(255).optional(),
  aiTitle:         z.string().trim().min(1).max(120).nullable().optional(),
  bodyMd:          z.string().min(1).max(100_000).optional(),
  summary:         z.string().trim().max(1000).nullable().optional(),
  execSummary:     z.array(z.string().trim().min(1).max(500)).max(15).optional(),
  type:            memoryTypeSchema.optional(),
  realmId:         z.string().uuid().nullable().optional(),
  projectId:       z.string().uuid().nullable().optional(),
  taskId:          z.string().uuid().nullable().optional(),
  dominionId:      z.string().uuid().nullable().optional(),
  tags:            z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  pinned:          z.boolean().optional(),
  archivedAt:      z.string().datetime().nullable().optional(),
})

// Kairos Phase 1 (A2) — capture endpoint payload. Superset of createMemory
// with `channel` for inbound normalisation; the route handler will fold it
// into sourceMetadata before persistence. externalId (inside sourceMetadata)
// is the idempotency key.
export const captureMemorySchema = z.object({
  title:           z.string().trim().min(1).max(255),
  bodyMd:          z.string().min(1).max(100_000),
  aiTitle:         z.string().trim().min(1).max(120).optional(),
  summary:         z.string().trim().max(1000).optional(),
  execSummary:     z.array(z.string().trim().min(1).max(500)).max(15).optional(),
  type:            memoryTypeSchema.default('note'),
  source:          memorySourceSchema.default('manual'),
  channel:         z.string().trim().min(1).max(60).nullable().optional(),
  sourceMetadata:  memorySourceMetadataSchema.optional(),
  realmId:         z.string().uuid().nullable().optional(),
  projectId:       z.string().uuid().nullable().optional(),
  taskId:          z.string().uuid().nullable().optional(),
  dominionId:      z.string().uuid().nullable().optional(),
  tags:            z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  links:           z.array(memoryLinkSchema).max(50).optional(),
  pinned:          z.boolean().optional(),
})

export type CaptureMemoryRequest = z.infer<typeof captureMemorySchema>

// Kairos Phase 3B — `query` is optional when `dominionId` is provided, so
// lieutenants can pull "recent memories on this Dominion" without inventing
// a search term. `sinceDays` bounds the window (defaults to no bound).
export const searchMemoriesSchema = z.object({
  query:           z.string().trim().min(2).max(500).optional(),
  type:            z.union([memoryTypeSchema, z.array(memoryTypeSchema)]).optional(),
  source:          z.union([memorySourceSchema, z.array(memorySourceSchema)]).optional(),
  realmId:         z.string().uuid().optional(),
  projectId:       z.string().uuid().optional(),
  taskId:          z.string().uuid().optional(),
  dominionId:      z.string().uuid().optional(),
  sinceDays:       z.number().int().min(1).max(365).optional(),
  tagsAny:         z.array(z.string()).max(50).optional(),
  tagsAll:         z.array(z.string()).max(50).optional(),
  pinnedOnly:      z.boolean().optional(),
  // Wave 1 "one search": machine rows (traces, snapshots, deltas, archetypes,
  // cortex, aether, advisories) are hidden unless the caller opts in.
  includeMachine:  z.boolean().optional(),
  // Graph step 1: widen the rerank pool with link neighbours and archetype
  // signposts. Absent → server default (SEARCH_EXPAND_DEFAULT).
  expand:          z.boolean().optional(),
  // Total Recall 2a: the entity list. Absent → SEARCH_ENTITY_DEFAULT.
  entity:          z.boolean().optional(),
  limit:           z.number().int().min(1).max(100).default(20),
  offset:          z.number().int().min(0).default(0),
}).refine(
  (v) => Boolean(v.query) || Boolean(v.dominionId),
  { message: 'query is required unless dominionId is provided', path: ['query'] },
)

export const addLinkSchema = z.object({
  target:          z.string().min(1).max(2048),
  targetKind:      memoryTargetKindSchema,
  type:            memoryEdgeTypeSchema,
  note:            z.string().trim().max(500).optional(),
})

export const getNeighboursSchema = z.object({
  hops:            z.union([z.literal(1), z.literal(2)]).default(1),
  includeReverse:  z.boolean().default(true),
  limit:           z.number().int().min(1).max(100).default(20),
})

// Belief trail — supersession lineage read-path. Single-field validator: the
// memory to trace, nothing else is tunable.
export const getBeliefTrailSchema = z.object({
  id:              z.string().uuid(),
})

// Brain Phase 4 — prepare_context. Single retrieval call that returns a
// budget-packed markdown bundle ready to drop into an AI context window.
// Spec: docs/brain/04-phase-roadmap.md (Phase 4)
export const prepareContextSchema = z.object({
  query:           z.string().trim().min(2).max(500),
  budgetTokens:    z.number().int().min(500).max(50_000).default(4000),
  realmId:         z.string().uuid().optional(),
  type:            z.union([memoryTypeSchema, z.array(memoryTypeSchema)]).optional(),
  hops:            z.union([z.literal(0), z.literal(1)]).default(1),
  maxSources:      z.number().int().min(5).max(100).default(30),
  includePinned:   z.boolean().default(true),
  // One mind (spec_one_mind): prepend "## Today across channels" (≤15% of budget).
  includeToday:    z.boolean().default(true),
  // Wave 1 "one search": optional Dominion scope (FK or soft dominion: tag)
  // and the same machine-row opt-in as search_memories.
  dominionId:      z.string().uuid().optional(),
  includeMachine:  z.boolean().optional(),
  // Same pool expansion and entity list switches as search_memories.
  expand:          z.boolean().optional(),
  entity:          z.boolean().optional(),
})

export type MemoryType        = z.infer<typeof memoryTypeSchema>
export type MemorySource      = z.infer<typeof memorySourceSchema>
export type MemoryEdgeType    = z.infer<typeof memoryEdgeTypeSchema>
export type MemoryTargetKind  = z.infer<typeof memoryTargetKindSchema>
export type MemoryLink        = z.infer<typeof memoryLinkSchema>
export type CreateMemoryInput = z.infer<typeof createMemorySchema>
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>
export type SearchMemoriesInput = z.infer<typeof searchMemoriesSchema>
export type AddLinkInput      = z.infer<typeof addLinkSchema>
export type GetNeighboursInput = z.infer<typeof getNeighboursSchema>
export type GetBeliefTrailInput = z.infer<typeof getBeliefTrailSchema>
export type PrepareContextInput = z.infer<typeof prepareContextSchema>

// Guided introspection — accept a staged proposal (type='inbound' memory Kairos
// proposed) into a committed, operator-endorsed memory. Reject is just
// update_memory(archivedAt); list is search_memories(type:'inbound').
export const acceptProposalSchema = z.object({
  pin:        z.boolean().default(false),
  asType:     z.enum(['reflection', 'observation', 'note', 'decision']).optional()
                .describe('Override the committed memory type (default derived from the proposal kind)'),
  supersedes: z.array(z.string().uuid()).max(20).optional()
                .describe('Memory ids this accepted belief replaces (stamped superseded, not deleted)'),
})
export type AcceptProposalInput = z.infer<typeof acceptProposalSchema>
