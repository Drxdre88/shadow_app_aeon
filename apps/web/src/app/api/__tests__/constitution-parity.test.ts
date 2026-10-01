/**
 * Constitution MCP <-> REST parity test (docs/kairos/34 §2).
 *
 * Mirrors memory-ops-parity.test.ts. The constitution must be reachable
 * identically from Claude (MCP) and external clients (REST):
 *   - get_constitution               <-> GET  /api/v1/kairos/constitution
 *   - propose_constitution_amendment <-> POST /api/v1/kairos/constitution/amendments
 * Both surfaces share the validators in lib/data/validators/constitution.ts and
 * the same functions, both bind to the calling user, and neither surface can
 * write the constitution itself (proposals only).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/constitution.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/kairos/constitution')

const REST_ROUTE_FILES = ['route.ts', 'amendments/route.ts']

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

describe('Constitution MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const restSrcConcat = REST_ROUTE_FILES.map((p) => readSource(path.join(REST_ROOT, p))).join('\n')

  it('exposes exactly the two constitution tools', () => {
    expect(new Set(extractToolNames(mcpSrc))).toEqual(new Set(['get_constitution', 'propose_constitution_amendment']))
  })

  it.each([
    { path: 'route.ts', methods: ['GET'] },
    { path: 'amendments/route.ts', methods: ['POST'] },
  ])('has route file + methods: $path', ({ path: routePath, methods }) => {
    const full = path.join(REST_ROOT, routePath)
    expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
    const src = readSource(full)
    for (const m of methods) expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
  })

  it.each(['getConstitutionSchema', 'proposeConstitutionAmendmentSchema'])('both surfaces use validator %s', (v) => {
    expect(mcpSrc).toMatch(new RegExp(`\\b${v}\\b`))
    expect(restSrcConcat).toMatch(new RegExp(`\\b${v}\\b`))
  })

  it('both surfaces import validators from the shared module', () => {
    expect(mcpSrc).toContain("from '@/lib/data/validators/constitution'")
    expect(restSrcConcat).toContain("from '@/lib/data/validators/constitution'")
  })

  it.each([
    ['getConstitutionOverview', '@/lib/kairos/constitution/amendment'],
    ['proposeConstitutionAmendment', '@/lib/kairos/constitution/amendment'],
  ])('both surfaces call %s from %s', (fn, mod) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '${mod.replace(/[/.]/g, '\\$&')}'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrcConcat).toMatch(importRe)
  })

  it('neither surface can apply an amendment (propose-not-commit)', () => {
    for (const src of [mcpSrc, restSrcConcat]) {
      expect(src).not.toMatch(/applyAcceptedConstitutionAmendment|acceptConstitutionProposalTx/)
    }
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
