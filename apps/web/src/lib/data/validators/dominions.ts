import { z } from 'zod'

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
