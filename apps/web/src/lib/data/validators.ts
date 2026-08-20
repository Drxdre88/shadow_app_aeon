import { z } from 'zod'

const isoDate = z
  .string()
  .trim()
  .min(1, 'Date is required')
  .refine((v) => !isNaN(new Date(v).getTime()), {
    message: 'Invalid ISO 8601 date string',
  })

const optionalIsoDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine(
    (v) => !v || !isNaN(new Date(v).getTime()),
    { message: 'Invalid ISO 8601 date string' }
  )

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(5000).optional(),
  startDate: isoDate,
  endDate: isoDate,
  timeScale: z.enum(['day', 'week', 'month']).default('week'),
})

export const setFavoriteSchema = z.object({ favorite: z.boolean() })

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  timeScale: z.enum(['day', 'week', 'month']).optional(),
  planetImage: z.string().max(255).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  dominionId: z.string().uuid().nullable().optional(),
})

export const createTaskSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional(),
  columnId: z.string().uuid().optional(),
  status: z.enum(['todo', 'in-progress', 'done']).default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  color: z.string().trim().max(20).default('purple'),
  onTimeline: z.boolean().default(false),
  size: z.number().min(0.5).max(20).multipleOf(0.5).nullable().optional(),
  // null = no progress tracked
  progress: z.number().int().min(0).max(100).nullable().optional(),
  orderIndex: z.number().int().optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  // Free-form card payload (AI Hangar mission lives under the `hangar` key).
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Free-form card payload. An AI Hangar mission lives under the "hangar" key.'),
})

export const updateTaskSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  columnId: z.string().uuid().optional(),
  status: z.enum(['todo', 'in-progress', 'done']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  color: z.string().trim().max(20).optional(),
  onTimeline: z.boolean().optional(),
  size: z.number().min(0.5).max(20).multipleOf(0.5).nullable().optional(),
  // null clears tracking; 0-100 otherwise
  progress: z.number().int().min(0).max(100).nullable().optional(),
  orderIndex: z.number().int().optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
  // Shallow-merged into the existing metadata, top-level keys only.
  metadata: z.record(z.string(), z.unknown()).optional()
    .describe('Shallow-merged into the existing metadata, top-level keys only. An AI Hangar mission lives under the "hangar" key.'),
})

export const createColumnSchema = z.object({
  name: z.string().trim().min(1).max(255),
  color: z.string().trim().max(20).default('purple'),
  icon: z.string().trim().max(50).optional(),
  orderIndex: z.number().int().optional(),
})

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(50).nullable().optional(),
  orderIndex: z.number().int().optional(),
})

export const createGanttTaskSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional(),
  rowId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  color: z.string().trim().max(20).default('purple'),
  progress: z.number().int().min(0).max(100).default(0),
  boardTaskId: z.string().uuid().optional(),
})

export const updateGanttTaskSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  rowId: z.string().uuid().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  color: z.string().trim().max(20).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  boardTaskId: z.string().uuid().nullable().optional(),
})

const ganttViewFiltersSchema = z.object({
  excludedSections: z.array(z.string()).optional(),
  taskOrder: z.enum(['column', 'alphabetical']).optional(),
  allowWeekends: z.boolean().optional(),
  allowMultipleRows: z.boolean().optional(),
  allowOverlap: z.boolean().optional(),
}).default({})

export const createGanttViewSchema = z.object({
  name: z.string().trim().min(1).max(255),
  groupBy: z.enum(['column', 'label', 'dependency', 'priority']).default('column'),
  filters: ganttViewFiltersSchema,
})

export const updateGanttViewSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  groupBy: z.enum(['column', 'label', 'dependency', 'priority']).optional(),
  filters: z.object({
    excludedSections: z.array(z.string()).optional(),
    taskOrder: z.enum(['column', 'alphabetical']).optional(),
    allowWeekends: z.boolean().optional(),
    allowMultipleRows: z.boolean().optional(),
    allowOverlap: z.boolean().optional(),
  }).optional(),
})

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(20).default('purple'),
})

export const updateLabelSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().trim().max(20).optional(),
})

export const createChecklistItemSchema = z.object({
  // Client-supplied id makes offline-queue replays idempotent (duplicate key
  // instead of a second row) and keeps optimistic local ids valid server-side.
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(2000),
  groupName: z.string().trim().max(255).optional(),
  orderIndex: z.number().int().optional(),
})

export const checklistItemStateSchema = z.enum(['unchecked', 'checked', 'crossed'])

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(2000).optional(),
  state: checklistItemStateSchema.optional(),
  status: z.string().trim().nullable().optional(),
})

export const createRowSchema = z.object({
  name: z.string().trim().min(1).max(255),
  color: z.string().trim().max(20).default('purple'),
  orderIndex: z.number().int().optional(),
})

export const updateRowSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  color: z.string().trim().max(20).optional(),
  orderIndex: z.number().int().optional(),
})

export const reorderRowsSchema = z.object({
  updates: z.array(z.object({
    id: z.string().uuid(),
    orderIndex: z.number().int().min(0),
  })).min(1),
})

export const reorderTaskEntrySchema = z.object({
  id: z.string().uuid(),
  orderIndex: z.number().int(),
  status: z.enum(['todo', 'in-progress', 'done']).optional(),
  columnId: z.string().uuid().optional(),
  name: z.string().optional(),
})

export const taskOrderSchema = z.enum(['column', 'alphabetical'])
export const groupByModeSchema = z.enum(['column', 'label', 'dependency', 'priority'])

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type CreateGanttTaskInput = z.infer<typeof createGanttTaskSchema>
export type UpdateGanttTaskInput = z.infer<typeof updateGanttTaskSchema>
export type CreateGanttViewInput = z.infer<typeof createGanttViewSchema>
export type UpdateGanttViewInput = z.infer<typeof updateGanttViewSchema>
export const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(10000),
})

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1).max(10000),
})

export const dependencyPairSchema = z.object({
  blockerTaskId: z.string().uuid(),
  blockedTaskId: z.string().uuid(),
}).refine((data) => data.blockerTaskId !== data.blockedTaskId, {
  message: 'A task cannot depend on itself',
})

export const createCanvasNodeSchema = z.object({
  type: z.string().trim().max(50).default('idea'),
  positionX: z.number().int(),
  positionY: z.number().int(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional(),
  color: z.string().trim().max(20).default('purple'),
})

export const updateCanvasNodeSchema = z.object({
  type: z.string().trim().max(50).optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  color: z.string().trim().max(20).optional(),
})

export const createCanvasEdgeSchema = z.object({
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  label: z.string().trim().max(255).optional(),
  animated: z.boolean().optional(),
})

export const createRealmSchema = z.object({
  name: z.string().trim().min(1).max(255),
  color: z.string().trim().max(20).default('purple'),
  icon: z.string().trim().max(50).optional(),
})

export const updateRealmSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  color: z.string().trim().max(20).optional(),
  icon: z.string().trim().max(50).nullable().optional(),
})

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']).default('editor'),
})

export const updateRoleSchema = z.object({
  role: z.enum(['editor', 'viewer']),
})

export const addProjectSchema = z.object({
  projectId: z.string().uuid(),
})

export const sendToVaultSchema = z.object({
  taskId: z.string().uuid(),
  daysTaken: z.number().int().min(0).max(9999).nullable(),
})

export const batchVaultSchema = z.object({
  entries: z.array(z.object({
    taskId: z.string().uuid(),
    daysTaken: z.number().int().min(0).max(9999).nullable(),
    taskName: z.string().optional(),
  })).min(1).max(100),
})

const customPrioritySchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

export const preferencesSchema = z.object({
  currentTheme: z.string().optional(),
  glowIntensity: z.number().min(0).max(100).optional(),
  glassOpacity: z.number().min(0).max(100).optional(),
  ambientBlobs: z.boolean().optional(),
  fontFamily: z.enum(['system', 'inter', 'jetbrains', 'space-grotesk', 'fira-code']).optional(),
  dragEffect: z.enum(['glow', 'ghost', 'lightning']).optional(),
  cursorEffect: z.string().optional(),
  cursorColor: z.string().optional(),
  columnWidth: z.number().min(250).max(1200).optional(),
  columnHeight: z.number().min(200).max(1600).optional(),
  dynamicColumnWidth: z.boolean().optional(),
  dynamicColumnHeight: z.boolean().optional(),
  smokeVolume: z.number().min(0).max(100).optional(),
  depLineWidth: z.number().min(0.3).max(3).optional(),
  depLineGlow: z.number().min(0).max(100).optional(),
  depLineStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
  depCanvasBlur: z.number().min(0).max(40).optional(),
  boardLayout: z.enum(['scroll', 'grid']).optional(),
  projectColors: z.record(z.string(), z.string()).optional(),
  depViewMode: z.enum(['canvas', 'arrows']).optional(),
  shortcuts: z.record(z.string(), z.string()).optional(),
  priorities: z.array(customPrioritySchema).optional(),
}).passthrough()

export type PreferencesInput = z.infer<typeof preferencesSchema>

export type CreateLabelInput = z.infer<typeof createLabelSchema>
export type CreateColumnInput = z.infer<typeof createColumnSchema>
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>
export type CreateRowInput = z.infer<typeof createRowSchema>
export type UpdateRowInput = z.infer<typeof updateRowSchema>
export type CreateCanvasNodeInput = z.infer<typeof createCanvasNodeSchema>
export type UpdateCanvasNodeInput = z.infer<typeof updateCanvasNodeSchema>

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
])
// Kairos Phase 1 (A1) — added sources: 'cron' (briefer/snapshot jobs),
// 'system' (board mutations, project lifecycle), 'webhook' (channel adapters).
export const memorySourceSchema = z.enum(['manual', 'claude', 'voice', 'hook', 'import', 'cron', 'system', 'webhook'])
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
  sourceMetadata:  z.record(z.string(), z.unknown()).optional(),
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
  sourceMetadata:  z.record(z.string(), z.unknown()).optional(),
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

// ─────────────────────────────────────────────────────────────────────────
// Kairos Dominion validators. See VISION.md "Bet 5: K-3 Dominion".
// ─────────────────────────────────────────────────────────────────────────

export const createDominionSchema = z.object({
  name:        z.string().trim().min(1).max(100),
  color:       z.string().trim().max(30).default('purple'),
  icon:        z.string().trim().max(50).optional(),
  sortOrder:   z.number().int().optional(),
  // Kairos Phase 1 (C11) — body fields can be set at creation or later.
  vision:      z.string().trim().max(4000).nullable().optional(),
  missionLong: z.string().trim().max(8000).nullable().optional(),
})

export const updateDominionSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  color:       z.string().trim().max(30).optional(),
  icon:        z.string().trim().max(50).optional(),
  sortOrder:   z.number().int().optional(),
  vision:      z.string().trim().max(4000).nullable().optional(),
  missionLong: z.string().trim().max(8000).nullable().optional(),
  archivedAt:  z.coerce.date().nullable().optional(),
})

export const addDominionRepoSchema = z.object({
  dominionId: z.string().uuid(),
  repoSlug:   z.string().trim().min(1).max(120),
})

// Kairos Phase 1 (C11) — Dominion objectives.
export const dominionObjectiveStatusSchema = z.enum(['active', 'paused', 'completed', 'abandoned'])

export const createDominionObjectiveSchema = z.object({
  dominionId:  z.string().uuid(),
  title:       z.string().trim().min(1).max(255),
  description: z.string().trim().max(8000).nullable().optional(),
  status:      dominionObjectiveStatusSchema.default('active'),
  targetDate:  z.coerce.date().nullable().optional(),
  sortOrder:   z.number().int().optional(),
})

export const updateDominionObjectiveSchema = z.object({
  title:       z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(8000).nullable().optional(),
  status:      dominionObjectiveStatusSchema.optional(),
  targetDate:  z.coerce.date().nullable().optional(),
  sortOrder:   z.number().int().optional(),
  archivedAt:  z.coerce.date().nullable().optional(),
})

export type CreateDominionInput          = z.infer<typeof createDominionSchema>
export type UpdateDominionInput          = z.infer<typeof updateDominionSchema>
export type AddDominionRepoInput         = z.infer<typeof addDominionRepoSchema>
export type DominionObjectiveStatus      = z.infer<typeof dominionObjectiveStatusSchema>
export type CreateDominionObjectiveInput = z.infer<typeof createDominionObjectiveSchema>
export type UpdateDominionObjectiveInput = z.infer<typeof updateDominionObjectiveSchema>

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3 (D15–D16) — agent_sessions / session_events validators.
// ─────────────────────────────────────────────────────────────────────────

export const agentSessionEngineSchema = z.enum(['claude', 'codex', 'copilot'])
export const agentSessionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'killed',
  'timeout',
])
export const sessionEventKindSchema = z.enum([
  'status',
  'tool_use',
  'tool_result',
  'message',
  'stop',
  'error',
  // AI Hangar — terminal envelope the runner posts when a mission ends.
  'result',
])

export const spawnSessionSchema = z.object({
  engine:     agentSessionEngineSchema,
  goal:       z.string().trim().min(1).max(2000),
  prompt:     z.string().trim().min(1).max(20_000),
  repo:       z.string().trim().max(200).nullable().optional(),
  branch:     z.string().trim().max(120).nullable().optional(),
  projectId:  z.string().uuid().nullable().optional(),
  realmId:    z.string().uuid().nullable().optional(),
  dominionId: z.string().uuid().nullable().optional(),
  // AI Hangar — board card this mission was launched from.
  taskId:     z.string().uuid().nullable().optional(),
  metadata:   z.record(z.string(), z.unknown()).optional(),
})

// Worker host calls this to flip status as the CLI starts / ends.
export const updateSessionStatusSchema = z.object({
  status:     agentSessionStatusSchema,
  workerHost: z.string().trim().max(120).nullable().optional(),
  workerPid:  z.number().int().nullable().optional(),
  exitCode:   z.number().int().nullable().optional(),
  startedAt:  z.coerce.date().nullable().optional(),
  endedAt:    z.coerce.date().nullable().optional(),
  costUsd:    z.number().nullable().optional(),
})

export const recordSessionEventSchema = z.object({
  seq:      z.number().int().min(0),
  kind:     sessionEventKindSchema,
  toolName: z.string().trim().max(80).nullable().optional(),
  payload:  z.record(z.string(), z.unknown()).optional(),
})

export const listSessionsSchema = z.object({
  status:     z.union([agentSessionStatusSchema, z.array(agentSessionStatusSchema)]).optional(),
  dominionId: z.string().uuid().optional(),
  projectId:  z.string().uuid().optional(),
  liveOnly:   z.boolean().default(false),
  since:      z.coerce.date().optional(),
  limit:      z.number().int().min(1).max(100).default(20),
  offset:     z.number().int().min(0).default(0),
})

export type AgentSessionEngine    = z.infer<typeof agentSessionEngineSchema>
export type AgentSessionStatus    = z.infer<typeof agentSessionStatusSchema>
export type SessionEventKind      = z.infer<typeof sessionEventKindSchema>
export type SpawnSessionInput     = z.infer<typeof spawnSessionSchema>
export type UpdateSessionStatusInput = z.infer<typeof updateSessionStatusSchema>
export type RecordSessionEventInput  = z.infer<typeof recordSessionEventSchema>
export type ListSessionsInput     = z.infer<typeof listSessionsSchema>

// ─────────────────────────────────────────────────────────────────────────
// AI Hangar (Sprint 1) — agent-mission cards, pull-mode claim, repo registry.
// See docs/ai-hangar-blueprint-1808.md §2 and §5.
// ─────────────────────────────────────────────────────────────────────────

export const hangarObjectiveSchema = z.enum([
  'bug_fix',
  'implement',
  'recon',
  'analysis',
  'plan',
])
// One engine enum for the whole system — a card's agent, a session's engine and
// a repo's allowed engines must never drift apart.
export const hangarAgentSchema = agentSessionEngineSchema
// Single value for now — the deliverable is derived from the objective.
export const hangarOutputModeSchema = z.enum(['auto'])

// Model ids are passed straight to an engine CLI by the runner, so the charset
// is restricted to what a real model id needs. The leading character must be
// alphanumeric so an id can never be read as a flag ('-p', '--dangerously-…').
export const HANGAR_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

// Stored under boardTasks.metadata.hangar. Card title carries the mission
// name; session_ids / last_result are system-written, never user-supplied.
export const hangarCardMetadataSchema = z.object({
  objective:   hangarObjectiveSchema,
  repo:        z.string().trim().min(1).max(120),
  agent:       hangarAgentSchema.default('copilot'),
  // The model id reaches the runner's CLI argv — keep it to a shell-inert
  // charset so a card can never smuggle flags or shell metacharacters.
  model:       z.string().trim().max(80).regex(HANGAR_MODEL_RE, 'Invalid model id').nullable().optional(),
  instruction: z.string().trim().min(1).max(20_000),
  outputMode:  hangarOutputModeSchema.default('auto'),
  subagents:   z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  sessionIds:  z.array(z.string().uuid()).default([]),
  lastResult:  z.record(z.string(), z.unknown()).optional(),
})

// Runner polls with its own id; engines narrows the claim to what it can spawn.
export const claimSessionSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
  engines:  z.array(hangarAgentSchema).min(1).optional(),
})

export const heartbeatSessionSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
})

// Engine-agnostic terminal envelope — the runner extracts it from stdout and
// posts it as the session's kind:'result' event.
export const hangarResultEnvelopeSchema = z.object({
  status:    z.enum(['completed', 'needs_input', 'failed']),
  outcome:   z.string().trim().max(60),
  summary:   z.string().trim().max(8000),
  branch:    z.string().trim().max(255).nullable().optional(),
  commit:    z.string().trim().max(64).nullable().optional(),
  artifacts: z.array(z.string().trim().max(500)).max(50).optional(),
  tests:     z.object({
    status:  z.enum(['passed', 'failed', 'not_run']),
    summary: z.string().trim().max(500).optional(),
  }).optional(),
  questions: z.array(z.string().trim().max(1000)).max(20).optional(),
  recommended_tasks: z.array(z.object({
    title:       z.string().trim().max(255),
    objective:   hangarObjectiveSchema,
    instruction: z.string().trim().max(10_000),
  })).max(20).optional(),
})

export const createHangarRepoSchema = z.object({
  realmId:        z.string().uuid(),
  slug:           z.string().trim().min(1).max(120),
  name:           z.string().trim().min(1).max(255),
  gitUrl:         z.string().trim().min(1).max(500),
  ghSlug:         z.string().trim().max(200).nullable().optional(),
  defaultBranch:  z.string().trim().max(120).optional(),
  branchPrefix:   z.string().trim().max(60).optional(),
  allowedEngines: z.array(hangarAgentSchema).optional(),
  runCmd:         z.string().trim().max(500).nullable().optional(),
  envSetupCmd:    z.string().trim().max(500).nullable().optional(),
  appUrl:         z.string().trim().max(500).nullable().optional(),
  notes:          z.string().trim().max(4000).nullable().optional(),
  active:         z.boolean().optional(),
  metadata:       z.record(z.string(), z.unknown()).optional(),
})

export const updateHangarRepoSchema = createHangarRepoSchema.omit({ realmId: true }).partial()

export type HangarObjective        = z.infer<typeof hangarObjectiveSchema>
export type HangarAgent            = z.infer<typeof hangarAgentSchema>
export type HangarOutputMode       = z.infer<typeof hangarOutputModeSchema>
export type HangarCardMetadata     = z.infer<typeof hangarCardMetadataSchema>
export type ClaimSessionInput      = z.infer<typeof claimSessionSchema>
export type HeartbeatSessionInput  = z.infer<typeof heartbeatSessionSchema>
export type HangarResultEnvelope   = z.infer<typeof hangarResultEnvelopeSchema>
export type CreateHangarRepoInput  = z.infer<typeof createHangarRepoSchema>
export type UpdateHangarRepoInput  = z.infer<typeof updateHangarRepoSchema>
