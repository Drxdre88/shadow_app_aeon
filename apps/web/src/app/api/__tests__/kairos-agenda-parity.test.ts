/**
 * Horae (Kairos's agenda) MCP <-> REST parity + owner-cancel guard.
 *
 * Mirrors kairos-promises-parity.test.ts. The agenda is reachable identically
 * from Claude (MCP) and external clients, read-only:
 *   - list_kairos_agenda <-> GET /api/v1/kairos/agenda
 * Both share lib/data/validators/kairos-agenda.ts and the same data fns.
 *
 * Booked by the server, cancelled by the owner: nothing under the MCP
 * transport, the REST v1 surface or the thinking queue may import a cancel /
 * mutate path. The thinking queue may book (create) and fire, nothing else.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-agenda.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/agenda/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos agenda MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only agenda tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['list_kairos_agenda'])
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
      expect(src).toContain("from '@/lib/data/validators/kairos-agenda'")
      expect(src).toMatch(/\blistKairosAgendaSchema\b/)
    }
  })

  it.each(['listKairosAgenda', 'toKairosAgendaView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-agenda'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/listKairosAgenda\(uid,/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/listKairosAgenda\(result\.id,/)
  })

  it('is exported, registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/export \{ registerKairosAgendaTools \} from '\.\/kairos-agenda'/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosAgendaTools, \[/)
    expect(read(MCP_DOCS)).toContain("'list_kairos_agenda'")
  })
})

const FORBIDDEN_ROOTS = ['app/api/[transport]', 'app/api/v1', 'lib/kairos/thinking']
const FORBIDDEN_IDENTIFIERS = /\b(cancelAgendaItem|cancelOwnKairosAgendaItem|mutateKairosAgenda|routeAgendaCommands)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(agenda\/(cancel|telegram-commands)|actions\/kairos-agenda)['"]/
const AGENDA_MODULE = /from\s+['"]@\/lib\/kairos\/agenda\/([a-z-]+)['"]/
// What each guarded surface may import from lib/kairos/agenda.
const ALLOWED_AGENDA_MODULES: Record<string, ReadonlySet<string>> = {
  'app/api/[transport]': new Set(),
  'app/api/v1': new Set(),
  'lib/kairos/thinking': new Set(['create', 'fire', 'flag', 'prompt', 'rules']),
}

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

describe('Kairos agenda items are cancelled by the owner only', () => {
  it.each(FORBIDDEN_ROOTS)('nothing under %s imports a cancel / mutate path', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file)
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports an agenda writer`).not.toMatch(FORBIDDEN_IDENTIFIERS)
        expect(stmt, `${rel} imports an agenda writer module`).not.toMatch(FORBIDDEN_MODULES)
        const mod = stmt.match(AGENDA_MODULE)?.[1]
        if (mod) expect(ALLOWED_AGENDA_MODULES[root].has(mod), `${rel} imports agenda/${mod}`).toBe(true)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { cancelAgendaItem } from '@/lib/kairos/agenda/cancel'"
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_MODULES)
    expect(ALLOWED_AGENDA_MODULES['lib/kairos/thinking'].has(importStatements(sample)[0].match(AGENDA_MODULE)![1])).toBe(false)
  })
})
