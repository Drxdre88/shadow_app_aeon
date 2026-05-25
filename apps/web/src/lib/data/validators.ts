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
  orderIndex: z.number().int().optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
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
  orderIndex: z.number().int().optional(),
  startDate: optionalIsoDate,
  endDate: optionalIsoDate,
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
])
// Kairos Phase 1 (A1) — added sources: 'cron' (briefer/snapshot jobs),
// 'system' (board mutations, project lifecycle), 'webhook' (channel adapters).
export const memorySourceSchema = z.enum(['manual', 'claude', 'voice', 'hook', 'import', 'cron', 'system', 'webhook'])
export const memoryEdgeTypeSchema   = z.enum(['relates', 'supports', 'contradicts', 'supersedes', 'refers_to', 'blocks_thinking'])
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

export const searchMemoriesSchema = z.object({
  query:           z.string().trim().min(2).max(500),
  type:            z.union([memoryTypeSchema, z.array(memoryTypeSchema)]).optional(),
  source:          z.union([memorySourceSchema, z.array(memorySourceSchema)]).optional(),
  realmId:         z.string().uuid().optional(),
  projectId:       z.string().uuid().optional(),
  taskId:          z.string().uuid().optional(),
  tagsAny:         z.array(z.string()).max(50).optional(),
  tagsAll:         z.array(z.string()).max(50).optional(),
  pinnedOnly:      z.boolean().optional(),
  limit:           z.number().int().min(1).max(100).default(20),
  offset:          z.number().int().min(0).default(0),
})

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
export type PrepareContextInput = z.infer<typeof prepareContextSchema>

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
