/**
 * Kairos surprise MCP <-> REST parity + server-only writer guard.
 *
 * Cloned from kairos-stage-parity.test.ts. The surprise ledger is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - get_kairos_surprise <-> GET /api/v1/kairos/surprise
 * Both share lib/data/validators/kairos-surprise.ts and the same data fns.
 *
 * Server-only writes: nothing under the MCP transport or the REST v1 surface
 * may import a surprise writer (ledger or mark) — producers run server-side.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-surprise.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/surprise/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/McpTab.tsx')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos surprise MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only surprise tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_surprise'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-surprise'")
      expect(src).toMatch(/\bgetKairosSurpriseSchema\b/)
    }
  })

  it.each(['readKairosSurprise', 'toKairosSurpriseView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-surprise'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderSurpriseMarkdown\b[^}]*\} from '@\/lib\/kairos\/surprise\/render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readKairosSurprise\(uid\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readKairosSurprise\(result\.id\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosSurpriseTools/)
    expect(read(MCP_ROUTE)).toMatch(/registerKairosSurpriseTools\(server\)/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_surprise'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(mutateKairosSurprise|recordSurprise|applySurpriseEvent|applyReplayNight|openForUpdate|openMemories)\b/

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

describe('Kairos surprise is written by the server only', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports a surprise writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports a surprise writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { recordSurprise } from '@/lib/kairos/surprise'"
    expect(importStatements(sample)[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
