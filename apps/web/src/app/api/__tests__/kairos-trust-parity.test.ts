/**
 * Kairos trust MCP <-> REST parity + measurement-only import guards.
 *
 * Cloned from kairos-surprise-parity.test.ts. Earned trust per area is
 * reachable identically from Claude (MCP) and external clients, read-only:
 *   - get_kairos_trust <-> GET /api/v1/kairos/trust
 * Both share lib/data/validators/kairos-trust.ts, readKairosTrust and the
 * pure markdown renderer.
 *
 * Guards: nothing in lib/kairos/trust/**, the data fn or either surface may
 * import cold reads, the character score or the conscience (measurement-only),
 * nor any mutate* / settle* writer — trust is recomputed on read, never stored.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-trust.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/trust/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/McpTab.tsx')
const DATA_FILE = path.join(SRC, 'lib/data/kairos-trust.ts')
const TRUST_DIR = path.join(SRC, 'lib/kairos/trust')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos trust MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only trust tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_trust'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-trust'")
      expect(src).toMatch(/\bgetKairosTrustSchema\b/)
    }
  })

  it('both surfaces call readKairosTrust from the data layer with the parsed area', () => {
    const importRe = /import \{[^}]*\breadKairosTrust\b[^}]*\} from '@\/lib\/data\/kairos-trust'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
    expect(mcpSrc).toMatch(/readKairosTrust\(uid, \{ area: parsed\.data\.area \}\)/)
    expect(restSrc).toMatch(/readKairosTrust\(result\.id, \{ area: parsed\.data\.area \}\)/)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderTrustMarkdown\b[^}]*\} from '@\/lib\/kairos\/trust\/render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosTrustTools/)
    expect(read(MCP_ROUTE)).toMatch(/registerKairosTrustTools\(server\)/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_trust'")
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

const FORBIDDEN_MODULES = /['"][^'"]*(cold-reads|cold-read\/|\/character\/|\/character['"]|conscience)[^'"]*['"]/
const WRITER_IDENTIFIERS = /\b(mutate\w*|settle\w*)\b/

const guardedFiles = () => [...sourceFiles(TRUST_DIR), DATA_FILE, MCP_TOOL_FILE, REST_ROUTE]

describe('Kairos trust stays measurement-safe and read-only', () => {
  it('guards the trust module, the data fn and both surfaces', () => {
    const files = guardedFiles()
    expect(files.length).toBeGreaterThan(5)
    for (const file of files) expect(existsSync(file), file).toBe(true)
  })

  it.each(guardedFiles().map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s imports no cold read, character, conscience or writer', (_rel, file) => {
    for (const stmt of importStatements(read(file))) {
      expect(stmt, `${_rel}: ${stmt}`).not.toMatch(FORBIDDEN_MODULES)
      expect(stmt, `${_rel}: ${stmt}`).not.toMatch(WRITER_IDENTIFIERS)
    }
  })

  it('the guard itself would catch each forbidden import', () => {
    const samples = [
      "import { listColdReads } from '@/lib/data/cold-reads'",
      "import { compareColdRead } from '@/lib/kairos/cold-read/compare'",
      "import { score } from '@/lib/kairos/character/score'",
      "import { loadConscienceBlock } from '@/lib/kairos/conscience-context'",
      "const m = await import('@/lib/data/cold-reads')",
    ]
    for (const s of samples) expect(importStatements(s)[0]).toMatch(FORBIDDEN_MODULES)
    expect(importStatements("import { mutateKairosPredictions } from '@/lib/data/kairos-predictions'")[0]).toMatch(WRITER_IDENTIFIERS)
    expect(importStatements("import { settleKairosPrediction } from '@/lib/kairos/predictions/settle'")[0]).toMatch(WRITER_IDENTIFIERS)
  })

  it('the guard also catches dynamic imports', () => {
    const samples = [
      "const { mutateKairosPredictions } = await import('@/lib/data/kairos-predictions')",
      "const data = await import('@/lib/data/kairos-predictions')\nawait data.mutateKairosPredictions(userId)",
      "await (await import('@/lib/data/kairos-predictions')).mutateKairosPredictions(userId)",
      "import('@/lib/data/kairos-predictions').then(({ mutateKairosPredictions }) => mutateKairosPredictions())",
    ]
    for (const s of samples) expect(importStatements(s).join('\n')).toMatch(WRITER_IDENTIFIERS)
  })
})
