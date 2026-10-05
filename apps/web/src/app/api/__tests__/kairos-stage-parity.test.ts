/**
 * Kairos stage MCP <-> REST parity + server-only writer guard.
 *
 * Mirrors kairos-today-parity.test.ts. The stage (what Kairos is attending to)
 * is reachable identically from Claude (MCP) and external clients, read-only:
 *   - get_kairos_stage <-> GET /api/v1/kairos/stage
 * Both share lib/data/validators/kairos-stage.ts and the same data fns.
 *
 * Server-only writes: nothing under the MCP transport or the REST v1 surface
 * may import a stage writer — the selector runs only inside the thinking queue.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-stage.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/stage/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos stage MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only stage tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_stage'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-stage'")
      expect(src).toMatch(/\bgetKairosStageSchema\b/)
    }
  })

  it.each(['readKairosStage', 'toKairosStageView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-stage'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderStageBlock\b[^}]*\} from '@\/lib\/kairos\/stage\/render'/)
    }
  })

  it('both surfaces read pool as the "1" string, never a coerced boolean', () => {
    for (const src of [mcpSrc, restSrc]) expect(src).toMatch(/pool === '1'/)
    expect(read(path.join(SRC, 'lib/data/validators/kairos-stage.ts'))).not.toMatch(/coerce\.boolean/)
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readKairosStage\(uid\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readKairosStage\(result\.id\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosStageTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosStageTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_stage'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(mutateKairosStage|postStageCandidates|applyStagePost)\b/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

function importStatements(src: string): string[] {
  return src.match(/import[\s\S]*?from\s+['"][^'"]+['"]/g) ?? []
}

describe('Kairos stage is written by the server only', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports a stage writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports a stage writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { postStageCandidates } from '@/lib/kairos/stage'"
    expect(importStatements(sample)[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
