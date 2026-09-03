import { z } from 'zod'

export const isoDate = z
  .string()
  .trim()
  .min(1, 'Date is required')
  .refine((v) => !isNaN(new Date(v).getTime()), {
    message: 'Invalid ISO 8601 date string',
  })

export const optionalIsoDate = z
  .string()
  .trim()
  .nullable()
  .optional()
  .refine(
    (v) => !v || !isNaN(new Date(v).getTime()),
    { message: 'Invalid ISO 8601 date string' }
  )

/**
 * A nullable instant normalised to UTC ISO text. Anything Date can parse is
 * accepted ('2026', an offset like '+05:00') and comes out as the exact
 * `toISOString()` form, so a `::timestamp` cast downstream sees one shape;
 * an unparseable string is rejected instead of reaching the database.
 */
export const isoOrNull = z
  .string()
  .nullable()
  .transform((v, ctx) => {
    if (v === null) return null
    const t = new Date(v).getTime()
    if (isNaN(t)) {
      ctx.addIssue({ code: 'custom', message: 'Invalid ISO 8601 date string' })
      return z.NEVER
    }
    return new Date(t).toISOString()
  })
