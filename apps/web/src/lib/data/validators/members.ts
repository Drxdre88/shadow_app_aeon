import { z } from 'zod'

// Virtual team members — shared by server actions, REST v1 and MCP (parity).
// initials are optional on create (derived from name server-side when absent).
export const createVirtualMemberSchema = z.object({
  name:     z.string().trim().min(1).max(120),
  color:    z.string().trim().min(1).max(20).default('purple'),
  initials: z.string().trim().min(1).max(4).optional(),
})

export const updateVirtualMemberSchema = z.object({
  name:     z.string().trim().min(1).max(120).optional(),
  color:    z.string().trim().min(1).max(20).optional(),
  initials: z.string().trim().min(1).max(4).optional(),
})

export type CreateVirtualMemberInput = z.infer<typeof createVirtualMemberSchema>
export type UpdateVirtualMemberInput = z.infer<typeof updateVirtualMemberSchema>

// Per-realm display overrides for real members. Every field is tri-state:
// absent = leave alone, null = clear the override, a value = set it. The data
// layer deletes the row once the last override is cleared, so `null` is a real
// instruction here and must survive validation rather than being stripped.
export const updateMemberProfileSchema = z.object({
  initials:    z.string().trim().min(1).max(4).nullable().optional(),
  color:       z.string().trim().min(1).max(20).nullable().optional(),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
}).refine(
  (v) => v.initials !== undefined || v.color !== undefined || v.displayName !== undefined,
  { message: 'Nothing to update' },
)

export type UpdateMemberProfileInput = z.infer<typeof updateMemberProfileSchema>
