import { z } from 'zod'
import { listMemoryOpsSchema, memoryOpKindSchema, revertMemoryOpSchema } from '@/lib/data/validators/memory-ops'
import { listMemoryOps } from '@/lib/data/memory-ops'
import { revertMemoryOp } from '@/lib/kairos/engine/revert'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Memory engine change log (docs/kairos/32 §2.5) — what the engine changed and
// the operator's veto. Shares validators + data fns with
// /api/v1/kairos/memory-ops (locked by memory-ops-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerMemoryOpsTools: RegisterFn = (server) => {
  server.tool(
    'list_memory_ops',
    'List what the Kairos memory engine changed (newest first): promotions ("I now believe X"), decays, merges, re-scores, reactions and reverts, each with its before/after snapshot and reason. Filter by memoryId or op kind. Use the op id with revert_memory_op to veto a change.',
    {
      memoryId: z.string().uuid().optional().describe('Only ops that touched this memory'),
      op: memoryOpKindSchema.optional().describe('Only this op kind, e.g. "promote" or "merge"'),
      limit: z.number().int().min(1).max(200).optional().describe('Max ops to return (default 50)'),
    },
    { title: 'List Memory Ops', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listMemoryOpsSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const { memoryId, op, limit } = parsed.data
      const rows = await listMemoryOps(uid, { memoryId, ops: op ? [op] : undefined, limit })
      return ok({ count: rows.length, ops: rows })
    }
  )

  server.tool(
    'revert_memory_op',
    'Veto a memory-engine change: restore the memory to its state before the op (both rows for a merge), log a revert op and mark the original reverted. A vetoed promotion/decay/merge is not redone by the next nightly run. Fails for already-reverted ops, ops with nothing to restore, or when the memory has changed since.',
    { opId: z.string().uuid().describe('The memory op id (from list_memory_ops) to revert') },
    { title: 'Revert Memory Op', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = revertMemoryOpSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const res = await revertMemoryOp(uid, parsed.data.opId, { reason: 'operator veto (MCP)' })
      if (!res.ok) return res.reason === 'not_found' ? notFound('Memory op') : fail(`Cannot revert: ${res.reason}`)
      return ok(res)
    }
  )
}
