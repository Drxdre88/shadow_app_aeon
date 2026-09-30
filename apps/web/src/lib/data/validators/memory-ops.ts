import { z } from 'zod'

// Memory engine change log (docs/kairos/32 §2.5). Shared verbatim by the
// list_memory_ops / revert_memory_op MCP tools and the /api/v1/kairos/memory-ops
// REST routes (locked by memory-ops-parity.test.ts).

export const MEMORY_OP_KINDS = [
  'score',
  'promote',
  'decay',
  'reject',
  'merge',
  'concept_create',
  'concept_update',
  'feedback',
  'revert',
] as const

export const memoryOpKindSchema = z.enum(MEMORY_OP_KINDS)

export const listMemoryOpsSchema = z.object({
  memoryId: z.string().uuid().optional(),
  op: memoryOpKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const revertMemoryOpSchema = z.object({
  opId: z.string().uuid(),
})

export type ListMemoryOpsInput = z.infer<typeof listMemoryOpsSchema>
export type RevertMemoryOpInput = z.infer<typeof revertMemoryOpSchema>
