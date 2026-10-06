/**
 * Repo handover MCP <-> REST parity + read-only guards.
 *
 * Cloned from kairos-trust-parity.test.ts. The handover is reachable
 * identically from agents (MCP) and external clients, read-only:
 *   - get_repo_handover <-> GET /api/v1/kairos/repo-handover
 * Both share lib/data/validators/kairos-repo-handover.ts, readRepoHandover
 * and the pure markdown renderer. Assembled on read — nothing in the data fn
 * or either surface may import a writer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-repo-handover.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/repo-handover/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')
const DATA_FILE = path.join(SRC, 'lib/data/repo-handover.ts')
const RENDER_FILE = path.join(SRC, 'lib/kairos/repo-memory/render.ts')
const ALIASES_FILE = path.join(SRC, 'lib/kairos/repo-memory/aliases.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Repo handover MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only handover tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_repo_handover'])
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
      expect(src).toContain("from '@/lib/data/validators/kairos-repo-handover'")
      expect(src).toMatch(/\bgetRepoHandoverSchema\b/)
    }
  })

  it('both surfaces call readRepoHandover from the data layer with the parsed repo', () => {
    const importRe = /import \{[^}]*\breadRepoHandover\b[^}]*\} from '@\/lib\/data\/repo-handover'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
    expect(mcpSrc).toMatch(/readRepoHandover\(uid, \{ repo: parsed\.data\.repo \}\)/)
    expect(restSrc).toMatch(/readRepoHandover\(result\.id, \{ repo: parsed\.data\.repo \}\)/)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderRepoHandoverMarkdown\b[^}]*\} from '@\/lib\/kairos\/repo-memory\/render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
  })

  it('is registered on the MCP server for the vorath and hangar profiles', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosRepoHandoverTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosRepoHandoverTools, \['vorath', 'hangar'\]\]/)
  })

  it('is documented in the MCP tool catalog', () => {
    expect(read(MCP_DOCS)).toContain("'get_repo_handover'")
  })
})

const WRITER_IDENTIFIERS = /\b(mutate\w*|settle\w*|upsert\w*|insert\w*|create\w*|update\w*|delete\w*|archive\w*|mark\w*|move\w*)\b/
const LAYER_BREAKS = /['"]@\/lib\/actions\//

const guardedFiles = [DATA_FILE, RENDER_FILE, ALIASES_FILE, MCP_TOOL_FILE, REST_ROUTE]

describe('Repo handover stays read-only', () => {
  it.each(guardedFiles.map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s imports no writer and no server action', (rel, file) => {
    expect(existsSync(file), rel).toBe(true)
    for (const stmt of importStatements(read(file))) {
      expect(stmt, `${rel}: ${stmt}`).not.toMatch(WRITER_IDENTIFIERS)
      expect(stmt, `${rel}: ${stmt}`).not.toMatch(LAYER_BREAKS)
    }
  })

  it('the guard would catch a writer import', () => {
    expect(importStatements("import { upsertRepoPlaybook } from '@/lib/data/repo-memory'")[0]).toMatch(WRITER_IDENTIFIERS)
    expect(importStatements("import { moveTask } from '@/lib/actions/board'")[0]).toMatch(LAYER_BREAKS)
  })
})
