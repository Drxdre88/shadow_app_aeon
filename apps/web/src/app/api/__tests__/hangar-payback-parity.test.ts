/**
 * Hangar payback MCP <-> REST parity + read-only import guards.
 *
 * Cloned from kairos-trust-parity.test.ts. The payback ledger is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - get_agent_payback <-> GET /api/v1/hangar/payback
 * Both share lib/data/validators/payback.ts, readAgentPayback and the pure
 * markdown renderer.
 *
 * The mcpToolCatalog documentation assertion is owned by the catalog update
 * (parent integration) and is intentionally not asserted here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/hangar-payback.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/hangar/payback/route.ts')
const DATA_FILE = path.join(SRC, 'lib/data/payback.ts')
const PAYBACK_DIR = path.join(SRC, 'lib/kairos/payback')
const ACTION_FILE = path.join(SRC, 'lib/actions/payback.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Hangar payback MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only payback tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_agent_payback'])
    expect(read(path.join(SRC, 'components/ui/help/mcpToolCatalog.ts'))).toContain("'get_agent_payback'")
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
    expect(mcpSrc).toMatch(/destructiveHint: false/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/payback'")
      expect(src).toMatch(/\bgetAgentPaybackSchema\b/)
    }
  })

  it('both surfaces call readAgentPayback with the same parsed options', () => {
    const importRe = /import \{[^}]*\breadAgentPayback\b[^}]*\} from '@\/lib\/data\/payback'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
    expect(mcpSrc).toMatch(/readAgentPayback\(uid, \{ period, projectId, groupBy \}\)/)
    expect(restSrc).toMatch(/readAgentPayback\(result\.id, \{ period, projectId, groupBy \}\)/)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderPaybackMarkdown\b[^}]*\} from '@\/lib\/kairos\/payback\/render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
  })

  it('is registered on the MCP server', () => {
    expect(read(MCP_INDEX)).toMatch(/registerHangarPaybackTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerHangarPaybackTools, \[/)
  })

  it('the server action guards with requireMemberAccess / requireAuth', () => {
    const src = read(ACTION_FILE)
    expect(src).toMatch(/^'use server'/)
    expect(src).toMatch(/requireMemberAccess\(parsed\.projectId\)/)
    expect(src).toMatch(/requireAuth\(\)/)
  })
})

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

const WRITER_IDENTIFIERS = /\b(create\w*|update\w*|insert\w*|delete\w*|record\w*|mutate\w*|settle\w*|touchProject)\b/

const guardedFiles = () => [...sourceFiles(PAYBACK_DIR), DATA_FILE, MCP_TOOL_FILE, REST_ROUTE, ACTION_FILE]

describe('Hangar payback stays read-only', () => {
  it('guards the payback module, the data fn, the action and both surfaces', () => {
    const files = guardedFiles()
    expect(files.length).toBeGreaterThanOrEqual(5)
    for (const file of files) expect(existsSync(file), file).toBe(true)
  })

  it.each(guardedFiles().map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s imports no writer', (_rel, file) => {
    for (const stmt of importStatements(read(file))) expect(stmt, `${_rel}: ${stmt}`).not.toMatch(WRITER_IDENTIFIERS)
  })

  it('the data fn never writes to the database', () => {
    expect(read(DATA_FILE)).not.toMatch(/db\s*\.\s*(insert|update|delete|transaction)\b/)
  })

  it('the guard itself would catch a writer import', () => {
    expect(importStatements("import { updateAgentSessionStatus } from '@/lib/data/sessions'")[0]).toMatch(WRITER_IDENTIFIERS)
    expect(importStatements("import { touchProject } from '@/lib/data/projects'")[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
