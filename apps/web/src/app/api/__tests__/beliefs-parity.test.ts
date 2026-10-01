/**
 * Beliefs MCP <-> REST parity test (docs/kairos/34 §1).
 *
 * Mirrors memory-ops-parity.test.ts. The belief ledger and the weekly mind
 * comparison must be reachable identically from Claude (MCP) and external
 * clients (REST):
 *   - list_beliefs        <-> GET /api/v1/kairos/beliefs
 *   - get_mind_comparison <-> GET /api/v1/kairos/beliefs/compare
 * Both surfaces share the validators in lib/data/validators/beliefs.ts and the
 * same data functions, and both bind to the calling user.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/beliefs.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/kairos/beliefs')

const REST_ROUTE_FILES = ['route.ts', 'compare/route.ts']

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

describe('Beliefs MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const restSrcConcat = REST_ROUTE_FILES.map((p) => readSource(path.join(REST_ROOT, p))).join('\n')

  it('exposes exactly the two belief tools', () => {
    expect(new Set(extractToolNames(mcpSrc))).toEqual(new Set(['list_beliefs', 'get_mind_comparison']))
  })

  it('exports registerBeliefTools', () => {
    expect(mcpSrc).toMatch(/export const registerBeliefTools\b/)
  })

  it.each([
    { path: 'route.ts', methods: ['GET'] },
    { path: 'compare/route.ts', methods: ['GET'] },
  ])('has route file + methods: $path', ({ path: routePath, methods }) => {
    const full = path.join(REST_ROOT, routePath)
    expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
    const src = readSource(full)
    for (const m of methods) expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
  })

  it.each([
    ['listBeliefsSchema', 'route.ts'],
    ['getMindComparisonSchema', 'compare/route.ts'],
  ])('both surfaces use validator %s', (v, routeFile) => {
    expect(mcpSrc).toMatch(new RegExp(`\\b${v}\\b`))
    expect(readSource(path.join(REST_ROOT, routeFile))).toMatch(new RegExp(`\\b${v}\\b`))
  })

  it('both surfaces import validators from the shared module', () => {
    expect(mcpSrc).toContain("from '@/lib/data/validators/beliefs'")
    for (const r of REST_ROUTE_FILES) {
      expect(readSource(path.join(REST_ROOT, r))).toContain("from '@/lib/data/validators/beliefs'")
    }
  })

  it.each([
    ['listBeliefs', 'route.ts'],
    ['getLatestMindCompare', 'compare/route.ts'],
  ])('both surfaces call %s from @/lib/data/beliefs', (fn, routeFile) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/beliefs'`)
    expect(mcpSrc).toMatch(importRe)
    expect(readSource(path.join(REST_ROOT, routeFile))).toMatch(importRe)
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

  it('REST reads are scoped to the authenticated user', () => {
    expect(restSrcConcat).toMatch(/listBeliefs\(result\.id/)
    expect(restSrcConcat).toMatch(/getLatestMindCompare\(result\.id\)/)
  })
})
