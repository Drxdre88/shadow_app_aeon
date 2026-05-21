/**
 * Memory MCP <-> REST parity test.
 *
 * Mirrors gantt-parity.test.ts. The brain layer must expose the SAME memory
 * capabilities through both surfaces so Claude (MCP) and external clients
 * (REST) never diverge. This test statically verifies:
 *   - exactly the four expected MCP tools are registered
 *   - every MCP-exposed capability has a matching REST route file + method
 *   - both surfaces import the same validators from `@/lib/data/validators`
 *   - both surfaces call the same data functions from `@/lib/data/memories`
 *   - every mutation enforces userId ownership through the data layer's
 *     user-scoped queries (authenticated through authenticateRequest /
 *     getUserId)
 *
 * Documented exclusions (REST-only — no MCP counterpart by design):
 *   - DELETE /memories/[id]          (admin-y; AI rarely needs to delete)
 *   - PATCH  /memories/[id]          (admin-y)
 *   - GET    /memories               (paginated list — AI uses search instead)
 *   - GET    /memories/[id]          (single-fetch — AI uses search/neighbours)
 *   - DELETE /memories/[id]/links/[linkIndex]  (edge cleanup is admin)
 *   - GET    /memories/[id]/export   (markdown export)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/memories.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/memories')

const REST_ROUTE_FILES = [
  'route.ts',
  '[id]/route.ts',
  'search/route.ts',
  'context/route.ts',
  '[id]/links/route.ts',
  '[id]/links/[linkIndex]/route.ts',
  '[id]/neighbours/route.ts',
  '[id]/export/route.ts',
]

function readSource(p: string): string {
  return readFileSync(p, 'utf8')
}

function extractToolNames(src: string): string[] {
  const re = /server\.tool\(\s*['"]([a-z_]+)['"]/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names
}

describe('Memory MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const toolNames = extractToolNames(mcpSrc)
  const restSrcConcat = REST_ROUTE_FILES
    .map((p) => readSource(path.join(REST_ROOT, p)))
    .join('\n')

  describe('MCP tool surface', () => {
    it('exposes exactly the five expected memory operations', () => {
      expect(new Set(toolNames)).toEqual(new Set([
        'create_memory',
        'search_memories',
        'link_memory',
        'get_memory_with_neighbours',
        'prepare_context',
      ]))
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      { path: 'route.ts',                          methods: ['GET', 'POST'] },
      { path: '[id]/route.ts',                     methods: ['GET', 'PATCH', 'DELETE'] },
      { path: 'search/route.ts',                   methods: ['GET'] },
      { path: 'context/route.ts',                  methods: ['GET'] },
      { path: '[id]/links/route.ts',               methods: ['POST'] },
      { path: '[id]/links/[linkIndex]/route.ts',   methods: ['DELETE'] },
      { path: '[id]/neighbours/route.ts',          methods: ['GET'] },
      { path: '[id]/export/route.ts',              methods: ['GET'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = readSource(full)
      for (const m of methods) {
        expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })
  })

  describe('shared validator usage — MCP and REST speak the same schema', () => {
    const validators = [
      'createMemorySchema',
      'updateMemorySchema',
      'searchMemoriesSchema',
      'addLinkSchema',
      'getNeighboursSchema',
      'prepareContextSchema',
    ]

    it.each(validators)('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    // MCP uses every validator that has an MCP counterpart. updateMemorySchema
    // is REST-only (no MCP update_memory tool in Phase 1 — Claude is expected
    // to delete + recreate, which is also how mem0 semantically models updates).
    const mcpValidators = [
      'createMemorySchema',
      'searchMemoriesSchema',
      'addLinkSchema',
      'getNeighboursSchema',
      'prepareContextSchema',
    ]
    it.each(mcpValidators)('MCP tool file uses validator: %s', (v) => {
      expect(mcpSrc, `MCP memories.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })
  })

  describe('data-function parity — MCP and REST call the same underlying functions', () => {
    const sharedFns = [
      'createMemory',
      'searchMemoriesFts',
      'addLink',
      'findMemoryById',
      'getNeighbours',
      'prepareContext',
    ]

    it.each(sharedFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(sharedFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })
  })

  describe('user-scope enforcement — every tool + route binds to the calling user', () => {
    it('every MCP tool calls getUserId(extra)', () => {
      const toolBlocks = mcpSrc.split(/server\.tool\(/).slice(1)
      for (const block of toolBlocks) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing getUserId(extra) call`)
          .toMatch(/getUserId\(extra\)/)
      }
    })

    it('every REST route authenticates via authenticateRequest', () => {
      for (const r of REST_ROUTE_FILES) {
        const src = readSource(path.join(REST_ROOT, r))
        expect(src, `${r} missing authenticateRequest`)
          .toMatch(/authenticateRequest\(/)
      }
    })

    it('every REST route checks isApiUser before reading result.id', () => {
      for (const r of REST_ROUTE_FILES) {
        const src = readSource(path.join(REST_ROOT, r))
        expect(src, `${r} missing isApiUser narrow`)
          .toMatch(/isApiUser\(result\)/)
      }
    })
  })
})
