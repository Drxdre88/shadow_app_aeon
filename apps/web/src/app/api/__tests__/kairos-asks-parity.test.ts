/**
 * Kairos open-question backlog MCP <-> REST parity test.
 *
 * Mirrors beliefs-parity.test.ts. The Q-numbered backlog and the operator's
 * "skip" must be reachable identically from Claude (MCP) and external clients:
 *   - list_open_kairos_asks <-> GET  /api/v1/kairos/asks
 *   - dismiss_kairos_ask    <-> POST /api/v1/kairos/asks/[id]/dismiss
 * Both surfaces share the validators in lib/data/validators/kairos-asks.ts and
 * the same functions, and both bind to the calling user.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/ask.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/kairos/asks')
const REST_ROUTE_FILES = ['route.ts', '[id]/dismiss/route.ts']

const read = (p: string) => readFileSync(p, 'utf8')

function toolBlock(src: string, name: string): string {
  const block = src.split(/server\.tool\(/).slice(1).find((b) => b.trimStart().startsWith(`'${name}'`))
  if (!block) throw new Error(`MCP tool ${name} not registered`)
  return block
}

describe('Kairos asks MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)

  it.each([
    { path: 'route.ts', methods: ['GET'] },
    { path: '[id]/dismiss/route.ts', methods: ['POST'] },
  ])('has route file + methods: $path', ({ path: routePath, methods }) => {
    const full = path.join(REST_ROOT, routePath)
    expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
    const src = read(full)
    for (const m of methods) expect(src).toMatch(new RegExp(`export const ${m}\\b`))
  })

  it.each([
    ['list_open_kairos_asks', 'listOpenKairosAsksSchema', 'route.ts'],
    ['dismiss_kairos_ask', 'dismissKairosAskSchema', '[id]/dismiss/route.ts'],
  ])('%s and its REST twin share validator %s', (tool, validator, routeFile) => {
    expect(toolBlock(mcpSrc, tool)).toMatch(new RegExp(`\\b${validator}\\b`))
    expect(read(path.join(REST_ROOT, routeFile))).toMatch(new RegExp(`\\b${validator}\\b`))
  })

  it('both surfaces import validators from the shared module', () => {
    expect(mcpSrc).toContain("from '@/lib/data/validators/kairos-asks'")
    for (const r of REST_ROUTE_FILES) expect(read(path.join(REST_ROOT, r))).toContain("from '@/lib/data/validators/kairos-asks'")
  })

  it.each([
    ['list_open_kairos_asks', 'listOpenKairosAsks', '@/lib/data/ask', 'route.ts'],
    ['list_open_kairos_asks', 'toOpenKairosAskView', '@/lib/data/ask', 'route.ts'],
    ['dismiss_kairos_ask', 'dismissKairosAsk', '@/lib/kairos/ask', '[id]/dismiss/route.ts'],
  ])('%s and its REST twin both call %s', (tool, fn, mod, routeFile) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '${mod}'`)
    expect(mcpSrc).toMatch(importRe)
    expect(toolBlock(mcpSrc, tool)).toMatch(new RegExp(`\\b${fn}\\b`))
    expect(read(path.join(REST_ROOT, routeFile))).toMatch(importRe)
  })

  it('every MCP tool calls getUserId(extra)', () => {
    for (const block of mcpSrc.split(/server\.tool\(/).slice(1)) {
      const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
      expect(block, `MCP tool ${name} missing getUserId(extra)`).toMatch(/getUserId\(extra\)/)
    }
  })

  it('every REST route authenticates and is scoped to the authenticated user', () => {
    for (const r of REST_ROUTE_FILES) {
      const src = read(path.join(REST_ROOT, r))
      expect(src).toMatch(/authenticateRequest\(/)
      expect(src).toMatch(/isApiUser\(result\)/)
    }
    expect(read(path.join(REST_ROOT, 'route.ts'))).toMatch(/listOpenKairosAsks\(result\.id\)/)
    expect(read(path.join(REST_ROOT, '[id]/dismiss/route.ts'))).toMatch(/dismissKairosAsk\(result\.id,/)
  })
})
