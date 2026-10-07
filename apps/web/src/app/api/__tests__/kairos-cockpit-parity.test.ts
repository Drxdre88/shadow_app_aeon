/**
 * Morning cockpit MCP <-> REST parity + read-only import guards.
 *
 * Cloned from kairos-trust-parity.test.ts. The cockpit is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - get_morning_cockpit <-> GET /api/v1/kairos/cockpit
 * Both share lib/data/validators/kairos-cockpit.ts, readMorningCockpit and
 * the pure markdown renderer.
 *
 * Guards: the cockpit module, the data fn, the session action and both
 * surfaces import no writer (create/update/upsert/mark/mutate/settle/…) —
 * the cockpit is assembled on read, never stored.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-cockpit.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/cockpit/route.ts')
const DATA_FILE = path.join(SRC, 'lib/data/morning-cockpit.ts')
const ACTION_FILE = path.join(SRC, 'lib/actions/kairos-cockpit.ts')
const COCKPIT_DIR = path.join(SRC, 'lib/kairos/cockpit')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Morning cockpit MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only cockpit tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_morning_cockpit'])
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
      expect(src).toContain("from '@/lib/data/validators/kairos-cockpit'")
      expect(src).toMatch(/\bgetMorningCockpitSchema\b/)
    }
  })

  it('both surfaces call readMorningCockpit from the data layer for the caller', () => {
    const importRe = /import \{[^}]*\breadMorningCockpit\b[^}]*\} from '@\/lib\/data\/morning-cockpit'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
    expect(mcpSrc).toMatch(/readMorningCockpit\(uid\)/)
    expect(restSrc).toMatch(/readMorningCockpit\(result\.id\)/)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderCockpitMarkdown\b[^}]*\} from '@\/lib\/kairos\/cockpit\/render'/)
    }
  })

  it('binds to the calling user on both surfaces and the web session', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(read(ACTION_FILE)).toMatch(/await requireAuth\(\)/)
  })

  it('is registered on the MCP server', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosCockpitTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosCockpitTools, \[/)
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

const WRITER_IDENTIFIERS = /\b(mutate\w*|settle\w*|create[A-Z]\w*|update[A-Z]\w*|upsert\w*|insert\w*|delete[A-Z]\w*|mark[A-Z]\w*|record[A-Z]\w*|archive[A-Z]\w*|touchProject|db\.(insert|update|delete|transaction))\b/

const guardedFiles = () => [...sourceFiles(COCKPIT_DIR), DATA_FILE, ACTION_FILE, MCP_TOOL_FILE, REST_ROUTE]

describe('Morning cockpit stays read-only', () => {
  it('guards the cockpit module, the data fn, the action and both surfaces', () => {
    const files = guardedFiles()
    expect(files.length).toBeGreaterThanOrEqual(5)
    for (const file of files) expect(existsSync(file), file).toBe(true)
  })

  it.each(guardedFiles().map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s imports no writer', (rel, file) => {
    for (const stmt of importStatements(read(file))) expect(stmt, `${rel}: ${stmt}`).not.toMatch(WRITER_IDENTIFIERS)
  })

  it('the data file never writes through the db handle', () => {
    expect(read(DATA_FILE)).not.toMatch(/\bdb\s*\.\s*(insert|update|delete|transaction|execute)\b/)
  })

  it('the guard itself would catch writer imports', () => {
    const samples = [
      "import { mutateKairosPredictions } from '@/lib/data/kairos-predictions'",
      "import { markKairosAskDismissed } from '@/lib/data/ask'",
      "import { createAgentSession } from '@/lib/data/sessions'",
      "import { upsertRepoPlaybook } from '@/lib/data/repo-memory'",
      "const { recordSessionEvent } = await import('@/lib/data/sessions')",
    ]
    for (const s of samples) expect(importStatements(s).join('\n')).toMatch(WRITER_IDENTIFIERS)
  })
})
