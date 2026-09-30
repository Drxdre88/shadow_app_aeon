/**
 * Memory-ops MCP <-> REST parity test (docs/kairos/32 §2.5).
 *
 * Mirrors memories-parity.test.ts. The memory engine's change log and the
 * operator's veto must be reachable identically from Claude (MCP) and external
 * clients (REST):
 *   - list_memory_ops  <-> GET  /api/v1/kairos/memory-ops
 *   - revert_memory_op <-> POST /api/v1/kairos/memory-ops/[id]/revert
 * Both surfaces share the validators in lib/data/validators/memory-ops.ts and
 * the same underlying functions, and both bind to the calling user.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/memory-ops.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/kairos/memory-ops')

const REST_ROUTE_FILES = ['route.ts', '[id]/revert/route.ts']

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

describe('Memory-ops MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const restSrcConcat = REST_ROUTE_FILES.map((p) => readSource(path.join(REST_ROOT, p))).join('\n')

  it('exposes exactly the two memory-op tools', () => {
    expect(new Set(extractToolNames(mcpSrc))).toEqual(new Set(['list_memory_ops', 'revert_memory_op']))
  })

  it.each([
    { path: 'route.ts', methods: ['GET'] },
    { path: '[id]/revert/route.ts', methods: ['POST'] },
  ])('has route file + methods: $path', ({ path: routePath, methods }) => {
    const full = path.join(REST_ROOT, routePath)
    expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
    const src = readSource(full)
    for (const m of methods) expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
  })

  it.each(['listMemoryOpsSchema', 'revertMemoryOpSchema'])('both surfaces use validator %s', (v) => {
    expect(mcpSrc).toMatch(new RegExp(`\\b${v}\\b`))
    expect(restSrcConcat).toMatch(new RegExp(`\\b${v}\\b`))
  })

  it('both surfaces import validators from the shared module', () => {
    expect(mcpSrc).toContain("from '@/lib/data/validators/memory-ops'")
    expect(restSrcConcat).toContain("from '@/lib/data/validators/memory-ops'")
  })

  it.each([
    ['listMemoryOps', '@/lib/data/memory-ops'],
    ['revertMemoryOp', '@/lib/kairos/engine/revert'],
  ])('both surfaces call %s from %s', (fn, mod) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '${mod.replace(/[/.]/g, '\\$&')}'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrcConcat).toMatch(importRe)
  })

  it('every MCP tool calls getUserId(extra)', () => {
    for (const block of mcpSrc.split(/server\.tool\(/).slice(1)) {
      const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
      expect(block, `MCP tool ${name} missing getUserId(extra) call`).toMatch(/getUserId\(extra\)/)
    }
  })

  it('every REST route authenticates and narrows with isApiUser', () => {
    for (const r of REST_ROUTE_FILES) {
      const src = readSource(path.join(REST_ROOT, r))
      expect(src, `${r} missing authenticateRequest`).toMatch(/authenticateRequest\(/)
      expect(src, `${r} missing isApiUser narrow`).toMatch(/isApiUser\(result\)/)
    }
  })
})
