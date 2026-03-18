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
  filters: ganttViewFiltersSchema.optional(),
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
  title: z.string().trim().min(1).max(500),
  groupName: z.string().trim().max(255).optional(),
  orderIndex: z.number().int(),
})

export const checklistItemStateSchema = z.enum(['unchecked', 'checked', 'crossed'])

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  state: checklistItemStateSchema.optional(),
  status: z.string().trim().nullable().optional(),
})

export const createRowSchema = z.object({
  name: z.string().trim().min(1).max(255),
  color: z.string().trim().max(20).default('purple'),
  orderIndex: z.number().int(),
})

export const updateRowSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  color: z.string().trim().max(20).optional(),
  orderIndex: z.number().int().optional(),
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
export const addDependencySchema = z.object({
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

export type CreateLabelInput = z.infer<typeof createLabelSchema>
export type CreateColumnInput = z.infer<typeof createColumnSchema>
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>
export type CreateCanvasNodeInput = z.infer<typeof createCanvasNodeSchema>
export type UpdateCanvasNodeInput = z.infer<typeof updateCanvasNodeSchema>
