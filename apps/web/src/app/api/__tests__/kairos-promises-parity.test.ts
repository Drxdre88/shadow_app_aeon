/**
 * Kairos promises MCP <-> REST parity + owner-only guard.
 *
 * Mirrors kairos-asks-parity.test.ts. The promise list is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - list_kairos_promises <-> GET /api/v1/kairos/promises
 * Both share lib/data/validators/kairos-promises.ts and the same data fns.
 *
 * Owner-only (constitution-parity.test.ts shape): nothing under the MCP
 * transport, the REST v1 surface or the thinking queue may import the
 * close / drop / renegotiate paths or the raw promise writer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-promises.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/promises/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/McpTab.tsx')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos promises MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only promise tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['list_kairos_promises'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-promises'")
      expect(src).toMatch(/\blistKairosPromisesSchema\b/)
    }
  })

  it.each(['listKairosPromises', 'toKairosPromiseView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-promises'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/listKairosPromises\(uid,/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/listKairosPromises\(result\.id,/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_ROUTE)).toMatch(/registerKairosPromiseTools\(server\)/)
    expect(read(MCP_DOCS)).toContain("'list_kairos_promises'")
  })
})

const FORBIDDEN_ROOTS = ['app/api/[transport]', 'app/api/v1', 'lib/kairos/thinking']
const FORBIDDEN_IDENTIFIERS = /\b(closeKairosPromise|renegotiateKairosPromise|keepKairosPromise|dropKairosPromise|renegotiateOwnKairosPromise|mutateKairosPromises|verifyOpenPromises|runPromiseNudges|feedBackPromiseClose|creditBackward)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(promises\/(close|check|nudge)|actions\/kairos-promises|surprise\/credit)['"]/

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

describe('Kairos promises are owner-closed only', () => {
  it.each(FORBIDDEN_ROOTS)('nothing under %s imports a close / drop / renegotiate path', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const stmt of importStatements(read(file))) {
        const rel = path.relative(SRC, file)
        expect(stmt, `${rel} imports a promise writer`).not.toMatch(FORBIDDEN_IDENTIFIERS)
        expect(stmt, `${rel} imports a promise writer module`).not.toMatch(FORBIDDEN_MODULES)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { closeKairosPromise } from '@/lib/kairos/promises/close'"
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_MODULES)
  })
})
