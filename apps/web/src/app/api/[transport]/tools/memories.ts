import { z } from 'zod'
import {
  createMemorySchema,
  searchMemoriesSchema,
  addLinkSchema,
  getNeighboursSchema,
} from '@/lib/data/validators'
import {
  createMemory as _createMemory,
  searchMemoriesFts as _searchMemoriesFts,
  addLink as _addLink,
  findMemoryById,
  getNeighbours as _getNeighbours,
  targetMemoryExists,
} from '@/lib/data/memories'
import { verifyProjectAccess } from '@/lib/data/projects'
import { db } from '@/lib/db'
import { boardTasks, groupMembers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Brain MCP tools — 4 tools sharing validators + data fns with REST.
// Spec: docs/brain/02-mcp-tools.md
// Parity lock: src/app/api/__tests__/memories-parity.test.ts (P1.8)
// ─────────────────────────────────────────────────────────────────────────

async function verifyAnchors(
  userId: string,
  anchors: { realmId?: string | null; projectId?: string | null; taskId?: string | null }
): Promise<string | null> {
  if (anchors.realmId) {
    const [m] = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, anchors.realmId), eq(groupMembers.userId, userId)))
      .limit(1)
    if (!m) return 'Realm not accessible'
  }
  if (anchors.projectId) {
    const access = await verifyProjectAccess(anchors.projectId, userId)
    if (!access) return 'Project not accessible'
  }
  if (anchors.taskId) {
    const [t] = await db
      .select({ projectId: boardTasks.projectId })
      .from(boardTasks)
      .where(eq(boardTasks.id, anchors.taskId))
      .limit(1)
    if (!t) return 'Task not found'
    const access = await verifyProjectAccess(t.projectId, userId)
    if (!access) return 'Task not accessible'
  }
  return null
}

export const registerMemoryTools: RegisterFn = (server) => {
  server.tool(
    'create_memory',
    'Create a memory in the user-scoped brain. Memories can optionally anchor to a realm, project, or task, and link to other entities with typed edges.',
    {
      title: z.string().min(1).max(255).describe('Short title for the memory'),
      bodyMd: z.string().min(1).max(100_000).describe('Markdown body — the full thought, note, or summary'),
      summary: z.string().max(1000).optional().describe('One-line compression used by context packing'),
      type: z.enum(['note', 'decision', 'idea', 'observation', 'session_summary', 'reflection']).default('note').optional(),
      source: z.enum(['manual', 'claude', 'voice', 'hook', 'import']).default('claude').optional(),
      sourceMetadata: z.record(z.string(), z.unknown()).optional().describe('Provenance — e.g. {repo, branch, sessionId, filesTouched, commits}'),
      realmId: z.string().uuid().nullable().optional(),
      projectId: z.string().uuid().nullable().optional(),
      taskId: z.string().uuid().nullable().optional(),
      tags: z.array(z.string().min(1).max(50)).max(50).optional(),
      pinned: z.boolean().optional(),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = createMemorySchema.safeParse({
        ...args,
        source: args.source ?? 'claude',
      })
      if (!parsed.success) return fail(parsed.error.issues[0].message)

      const anchorErr = await verifyAnchors(uid, parsed.data)
      if (anchorErr) return fail(anchorErr)

      const memory = await _createMemory(uid, parsed.data)
      return ok({
        id: memory.id,
        title: memory.title,
        type: memory.type,
        source: memory.source,
        createdAt: memory.createdAt,
      })
    }
  )

  server.tool(
    'search_memories',
    'Full-text search the user-scoped brain. Returns ranked hits with snippet excerpts. Use this before answering questions that may have prior context.',
    {
      query: z.string().min(2).max(500).describe('Search query — supports websearch syntax (quotes, OR, -term)'),
      type: z.union([
        z.enum(['note', 'decision', 'idea', 'observation', 'session_summary', 'reflection']),
        z.array(z.enum(['note', 'decision', 'idea', 'observation', 'session_summary', 'reflection'])),
      ]).optional(),
      realmId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
      pinnedOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = searchMemoriesSchema.safeParse({
        query: args.query,
        type: args.type,
        realmId: args.realmId,
        projectId: args.projectId,
        taskId: args.taskId,
        pinnedOnly: args.pinnedOnly,
        limit: args.limit ?? 20,
        offset: 0,
      })
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const result = await _searchMemoriesFts(uid, parsed.data)
      return ok(result)
    }
  )

  server.tool(
    'link_memory',
    'Add a typed edge from a memory to another entity (memory, task, project, realm, or URL). Edge types: relates, supports, contradicts, supersedes, refers_to, blocks_thinking.',
    {
      memoryId: z.string().uuid().describe('The source memory UUID'),
      target: z.string().min(1).max(2048).describe('Target ID (UUID) or URL string'),
      targetKind: z.enum(['memory', 'task', 'project', 'realm', 'url']),
      type: z.enum(['relates', 'supports', 'contradicts', 'supersedes', 'refers_to', 'blocks_thinking']),
      note: z.string().max(500).optional().describe('Optional one-liner describing the edge'),
    },
    async ({ memoryId, ...rest }, extra) => {
      const uid = getUserId(extra)
      const parsed = addLinkSchema.safeParse(rest)
      if (!parsed.success) return fail(parsed.error.issues[0].message)

      // Verify the target is reachable by the user.
      if (parsed.data.targetKind === 'memory') {
        const exists = await targetMemoryExists(parsed.data.target, uid)
        if (!exists) return fail('Target memory not found')
      } else if (parsed.data.targetKind !== 'url') {
        const anchorErr = await verifyAnchors(uid, {
          projectId: parsed.data.targetKind === 'project' ? parsed.data.target : undefined,
          taskId:    parsed.data.targetKind === 'task'    ? parsed.data.target : undefined,
          realmId:   parsed.data.targetKind === 'realm'   ? parsed.data.target : undefined,
        })
        if (anchorErr) return fail(anchorErr)
      }

      const result = await _addLink(memoryId, uid, parsed.data)
      if (!result) return notFound('Memory')
      return ok({
        memoryId,
        link: result.link,
        linksCount: result.linksCount,
        created: result.created,
      })
    }
  )

  server.tool(
    'get_memory_with_neighbours',
    'Read a memory plus its 1-2 hop typed neighbours. Useful for context packing — pulls related decisions, supporting observations, and contradictions in one call.',
    {
      memoryId: z.string().uuid(),
      hops: z.union([z.literal(1), z.literal(2)]).default(1).optional(),
      includeReverse: z.boolean().default(true).optional().describe('Also include memories that link TO this one'),
      limit: z.number().int().min(1).max(100).default(20).optional(),
    },
    async ({ memoryId, hops, includeReverse, limit }, extra) => {
      const uid = getUserId(extra)
      const parsed = getNeighboursSchema.safeParse({
        hops: hops ?? 1,
        includeReverse: includeReverse ?? true,
        limit: limit ?? 20,
      })
      if (!parsed.success) return fail(parsed.error.issues[0].message)

      const memory = await findMemoryById(memoryId, uid)
      if (!memory) return notFound('Memory')

      const neighbours = await _getNeighbours(memoryId, uid, parsed.data)
      return ok({ memory, neighbours })
    }
  )
}
