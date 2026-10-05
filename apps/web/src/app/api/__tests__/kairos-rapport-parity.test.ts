/**
 * Kairos rapport MCP <-> REST parity + server-only writer guard.
 *
 * Cloned from kairos-surprise-parity.test.ts. Rapport state is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - get_kairos_rapport <-> GET /api/v1/kairos/rapport
 * Both share lib/data/validators/kairos-rapport.ts and the same data fns.
 *
 * Server-only writes: nothing under the MCP transport or the REST v1 surface
 * may import the rapport writer — producers run server-side.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-rapport.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/rapport/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos rapport MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only rapport tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_rapport'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-rapport'")
      expect(src).toMatch(/\bgetKairosRapportSchema\b/)
    }
  })

  it.each(['readKairosRapport', 'toKairosRapportView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-rapport'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces render markdown with the same pure renderer and report the same flags', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderRapportMarkdown\b[^}]*\} from '@\/lib\/kairos\/rapport\/render'/)
      expect(src).toMatch(/import \{[^}]*\brapportModes\b[^}]*\} from '@\/lib\/kairos\/rapport\/flag'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readKairosRapport\(uid, now\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readKairosRapport\(result\.id, now\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosRapportTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosRapportTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_rapport'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(mutateKairosRapport|onOwnerTurn|onChatReply|ackMediaBid|rapportOwnerDecision|rapportDailyDelivered|rapportSpeakPolicy)\b/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('Kairos rapport is written by the server only', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports a rapport writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports a rapport writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { mutateKairosRapport } from '@/lib/data/kairos-rapport'"
    expect(importStatements(sample)[0]).toMatch(WRITER_IDENTIFIERS)
  })

  it('the guard also catches dynamic imports', () => {
    const samples = [
      "const { mutateKairosRapport } = await import('@/lib/data/kairos-rapport')",
      "const data = await import('@/lib/data/kairos-rapport')\nawait data.mutateKairosRapport(userId)",
      "await (await import('@/lib/data/kairos-rapport')).mutateKairosRapport(userId)",
      "import('@/lib/data/kairos-rapport').then(({ mutateKairosRapport }) => mutateKairosRapport())",
    ]
    for (const s of samples) expect(importStatements(s).join('\n')).toMatch(WRITER_IDENTIFIERS)
  })
})
