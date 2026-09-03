import { z } from 'zod'
import { isoOrNull } from './dates'

// CHRONOS — work calendars and resources (migration 0035). Shared by every
// write surface; the identity rule mirrors resources_kind_identity_check.
const ianaTimezone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, { message: 'Unknown IANA timezone' })

const minuteOfDay = z.number().int().min(0).max(1439)

// Defaults live only on create: zod 4's .partial() keeps .default(), so an
// update built from the create shape would silently reset every omitted field.
const workCalendarFields = {
  name:           z.string().trim().min(1).max(120),
  timezone:       ianaTimezone,
  hoursPerDay:    z.number().gt(0).max(24),
  dayStartMinute: minuteOfDay,
  // Bitmask, bit 0 = Sunday .. bit 6 = Saturday; at least one working day.
  workweek:       z.number().int().min(1).max(127),
}

export const createWorkCalendarSchema = z.object({
  ...workCalendarFields,
  timezone:       workCalendarFields.timezone.default('UTC'),
  hoursPerDay:    workCalendarFields.hoursPerDay.default(8),
  dayStartMinute: workCalendarFields.dayStartMinute.default(540),
  workweek:       workCalendarFields.workweek.default(62),
})

export const updateWorkCalendarSchema = z.object(workCalendarFields).partial()

export const calendarExceptionSchema = z.object({
  day:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD'),
  isWorking:   z.boolean().default(false),
  hours:       z.number().gt(0).max(24).nullable().optional(),
  startMinute: minuteOfDay.nullable().optional(),
})

export const resourceKindSchema = z.enum(['user', 'virtual', 'agent'])

const resourceAttributes = {
  label:            z.string().trim().min(1).max(120).nullable().optional(),
  calendarId:       z.string().uuid().nullable().optional(),
  parentResourceId: z.string().uuid().nullable().optional(),
  concurrency:      z.number().int().min(1).max(32),
  focusFactor:      z.number().gt(0).max(1),
  orderIndex:       z.number().int().min(0).optional(),
}

export const createResourceSchema = z.object({
  kind:            resourceKindSchema,
  userId:          z.string().uuid().nullable().optional(),
  virtualMemberId: z.string().uuid().nullable().optional(),
  ...resourceAttributes,
  concurrency:     resourceAttributes.concurrency.default(1),
  focusFactor:     resourceAttributes.focusFactor.default(1),
}).superRefine((v, ctx) => {
  const hasUser = !!v.userId
  const hasVirtual = !!v.virtualMemberId
  const valid =
    (v.kind === 'user' && hasUser && !hasVirtual) ||
    (v.kind === 'virtual' && hasVirtual && !hasUser) ||
    (v.kind === 'agent' && !hasUser && !hasVirtual)
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      message: 'kind must match exactly one identity: user → userId, virtual → virtualMemberId, agent → neither',
    })
  }
})

export const updateResourceSchema = z.object(resourceAttributes).partial()

export type CreateWorkCalendarInput = z.infer<typeof createWorkCalendarSchema>
export type UpdateWorkCalendarInput = z.infer<typeof updateWorkCalendarSchema>
export type CalendarExceptionInput  = z.infer<typeof calendarExceptionSchema>
export type CreateResourceInput     = z.infer<typeof createResourceSchema>
export type UpdateResourceInput     = z.infer<typeof updateResourceSchema>

// The undo payload of a timeline reset: one entry per card, dates as UTC ISO
// text or null, capped so a client-held snapshot cannot grow a statement
// without bound.
export const TIMELINE_SNAPSHOT_MAX = 5000

export const timelineSnapshotSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      startDate: isoOrNull,
      endDate: isoOrNull,
      onTimeline: z.boolean(),
    }),
  )
  .max(TIMELINE_SNAPSHOT_MAX)

export type TimelineSnapshotInput = z.infer<typeof timelineSnapshotSchema>
