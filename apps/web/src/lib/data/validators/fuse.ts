import { z } from 'zod'
import { isoOrNull } from './dates'

// ---- Card fusion ---------------------------------------------------------

const fusePriority = z.enum(['low', 'medium', 'high', 'urgent'])
const dependencyEdgeSchema = z.object({
  blockerTaskId: z.string().uuid(),
  blockedTaskId: z.string().uuid(),
})

export const fuseTasksSchema = z.object({
  projectId: z.string().uuid(),
  /** The card dropped on — survives, renamed. */
  survivorId: z.string().uuid(),
  /** The dragged card — absorbed and removed. */
  sourceId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
}).refine((v) => v.survivorId !== v.sourceId, { message: 'A card cannot be fused into itself' })

// Everything unfuseTasks needs to put the board back: the survivor's prior
// scalars, the absorbed card's full row + relations, and the ids of every
// row the fusion re-pointed or added. Built by fuseTasks, held client-side
// by the undo toast, validated again when it comes back.
// Array caps: the undo replays every element inside one transaction on a
// pooled connection, so a client-held snapshot must not be able to grow a
// statement without bound. fuseTasks refuses up front when a card would
// exceed them, so a fusion that lands is always undoable.
export const FUSE_SNAPSHOT_LIMITS = { labels: 50, assignees: 100, childRows: 500, ganttRows: 50 } as const

export const fuseSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  survivorId: z.string().uuid(),
  sourceId: z.string().uuid(),
  survivorBefore: z.object({
    name: z.string().max(255),
    description: z.string().nullable(),
    priority: fusePriority,
    startDate: isoOrNull,
    endDate: isoOrNull,
    onTimeline: z.boolean(),
    size: z.number().nullable(),
    estimateMinutes: z.number().int().nullable(),
  }),
  source: z.object({
    id: z.string().uuid(),
    columnId: z.string().uuid().nullable(),
    ganttTaskId: z.string().uuid().nullable(),
    name: z.string().max(255),
    description: z.string().nullable(),
    status: z.string().max(20),
    priority: z.string().max(20),
    color: z.string().max(20),
    startDate: isoOrNull,
    endDate: isoOrNull,
    onTimeline: z.boolean(),
    size: z.number().nullable(),
    progress: z.number().int().nullable(),
    orderIndex: z.number().int(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: isoOrNull,
    estimateMinutes: z.number().int().nullable(),
    scheduleMode: z.string().max(10),
    constraintType: z.string().max(24),
    constraintDate: isoOrNull,
    computedStart: isoOrNull,
    computedEnd: isoOrNull,
    totalFloatMin: z.number().int().nullable(),
    isMilestone: z.boolean(),
    ownerResourceId: z.string().uuid().nullable(),
    startedAt: isoOrNull,
  }),
  sourceLabelIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.labels),
  sourceAssignees: z.array(z.object({ userId: z.string().uuid(), assignedBy: z.string().uuid().nullable(), assignedAt: z.string() })).max(FUSE_SNAPSHOT_LIMITS.assignees),
  sourceVirtualAssignees: z.array(z.object({ virtualMemberId: z.string().uuid(), assignedBy: z.string().uuid().nullable(), assignedAt: z.string() })).max(FUSE_SNAPSHOT_LIMITS.assignees),
  addedLabelIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.labels),
  addedAssigneeIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.assignees),
  addedVirtualAssigneeIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.assignees),
  /** Pre-fusion placement of the absorbed card's checklist items; the survivor's are renumbered on undo, not stored. */
  checklist: z.array(z.object({ id: z.string().uuid(), taskId: z.string().uuid(), orderIndex: z.number().int() })).max(FUSE_SNAPSHOT_LIMITS.childRows),
  sourceEdges: z.array(dependencyEdgeSchema).max(FUSE_SNAPSHOT_LIMITS.childRows),
  insertedEdges: z.array(dependencyEdgeSchema).max(FUSE_SNAPSHOT_LIMITS.childRows),
  commentIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.childRows),
  sessionIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.childRows),
  memoryIds: z.array(z.string().uuid()).max(FUSE_SNAPSHOT_LIMITS.childRows),
  ganttRows: z.array(z.object({
    id: z.string().uuid(),
    rowId: z.string().uuid().nullable(),
    name: z.string().max(255),
    description: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    color: z.string().max(20),
    progress: z.number().int(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })).max(FUSE_SNAPSHOT_LIMITS.ganttRows),
})

export type FuseTasksInput = z.infer<typeof fuseTasksSchema>
export type FuseSnapshot = z.infer<typeof fuseSnapshotSchema>
