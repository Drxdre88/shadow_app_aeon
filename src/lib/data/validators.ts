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
})

export const updateGanttTaskSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  rowId: z.string().uuid().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  color: z.string().trim().max(20).optional(),
  progress: z.number().int().min(0).max(100).optional(),
})

export const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(20).default('purple'),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type CreateGanttTaskInput = z.infer<typeof createGanttTaskSchema>
export type UpdateGanttTaskInput = z.infer<typeof updateGanttTaskSchema>
export const addDependencySchema = z.object({
  blockerTaskId: z.string().uuid(),
  blockedTaskId: z.string().uuid(),
}).refine((data) => data.blockerTaskId !== data.blockedTaskId, {
  message: 'A task cannot depend on itself',
})

export type CreateLabelInput = z.infer<typeof createLabelSchema>
export type CreateColumnInput = z.infer<typeof createColumnSchema>
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>
