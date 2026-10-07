/**
 * Decision journal MCP <-> REST parity + owner-only guards (P3-1).
 *
 * Styled on kairos-trust-parity.test.ts. The owner's decision journal is
 * reachable identically from Claude (MCP) and external clients:
 *   - log_decision   <-> POST /api/v1/kairos/decisions (relayed, owner confirms)
 *   - list_decisions <-> GET  /api/v1/kairos/decisions
 * Both share lib/data/validators/kairos-decisions.ts, the data fns and the
 * pure markdown renderer.
 *
 * Guards: no settle tool or route; neither surface may import a settle /
 * confirm / discard writer nor log as the owner; the journal stays apart from
 * Vorath's predictions and is never imported by any other Vorath module.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-decisions.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/decisions/route.ts')
const DATA_FILE = path.join(SRC, 'lib/data/kairos-decisions.ts')
const ACTIONS_FILE = path.join(SRC, 'lib/actions/kairos-decisions.ts')
const DECISIONS_DIR = path.join(SRC, 'lib/kairos/decisions')
const KAIROS_DIR = path.join(SRC, 'lib/kairos')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')

describe('Decision journal MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly log_decision and list_decisions — no settle tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['log_decision', 'list_decisions'])
    expect(mcpSrc).toMatch(/title: 'List Decisions', readOnlyHint: true/)
  })

  it('has the REST twin with GET + POST only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).toMatch(/export const POST\b/)
    expect(restSrc).not.toMatch(/export const (PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validators from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-decisions'")
      expect(src).toMatch(/\blogDecisionSchema\.safeParse\(/)
      expect(src).toMatch(/\blistDecisionsSchema\b/)
    }
  })

  it('both surfaces call the same data fns and the same pure renderer', () => {
    const dataImport = /import \{[^}]*\blistKairosDecisions\b[^}]*\blogKairosDecision\b[^}]*\} from '@\/lib\/data\/kairos-decisions'/
    expect(mcpSrc).toMatch(dataImport)
    expect(restSrc).toMatch(dataImport)
    expect(mcpSrc).toMatch(/listKairosDecisions\(uid, parsed\.data\)/)
    expect(restSrc).toMatch(/listKairosDecisions\(result\.id, parsed\.data\)/)
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderDecisionsMarkdown\b[^}]*\} from '@\/lib\/kairos\/decisions\/render'/)
    }
  })

  it('an agent log is always relayed, never the owner', () => {
    expect(mcpSrc).toMatch(/logKairosDecision\(uid, parsed\.data, \{ kind: 'relayed', via: 'mcp' \}\)/)
    expect(restSrc).toMatch(/logKairosDecision\(result\.id, parsed\.data, \{ kind: 'relayed', via: 'rest' \}\)/)
    for (const src of [mcpSrc, restSrc]) expect(src).not.toMatch(/kind: 'owner'/)
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
  })

  it('is registered on the MCP server under the vorath profile', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosDecisionTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosDecisionTools, \['vorath'\]\]/)
  })
})

const OWNER_WRITERS = /\b(settle\w*|confirm\w*|discard\w*)\b/

describe('Decision journal stays owner-only and apart from Vorath', () => {
  it('neither agent surface imports a settle / confirm / discard writer', () => {
    for (const file of [MCP_TOOL_FILE, REST_ROUTE]) {
      for (const stmt of importStatements(read(file))) expect(stmt, `${rel(file)}: ${stmt}`).not.toMatch(OWNER_WRITERS)
    }
  })

  it('the guard itself would catch a writer import', () => {
    expect(importStatements("import { settleKairosDecisionByOwner } from '@/lib/data/kairos-decisions'")[0]).toMatch(OWNER_WRITERS)
    expect(importStatements("const d = await import('@/lib/data/kairos-decisions')\nawait d.confirmKairosDecisionByOwner(u, id)").join('\n')).toMatch(OWNER_WRITERS)
  })

  it('the journal imports nothing from predictions except the pure metrics', () => {
    const files = [...sourceFiles(DECISIONS_DIR), DATA_FILE, ACTIONS_FILE, MCP_TOOL_FILE, REST_ROUTE]
    expect(files.length).toBeGreaterThan(7)
    for (const file of files) {
      for (const stmt of importStatements(read(file))) {
        if (!/predictions/.test(stmt)) continue
        expect(stmt, `${rel(file)}: ${stmt}`).toMatch(/from '@\/lib\/kairos\/predictions\/score'/)
      }
    }
  })

  it('no other Vorath module reads the journal (never fed to his prompts or track record)', () => {
    const others = sourceFiles(KAIROS_DIR).filter((f) => !f.startsWith(DECISIONS_DIR + path.sep))
    expect(others.length).toBeGreaterThan(50)
    for (const file of others) {
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel(file)}: ${stmt}`).not.toMatch(/kairos-decisions|\/decisions\//)
      }
    }
  })
})
