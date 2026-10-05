/**
 * Kairos idea taste MCP <-> REST parity + read-only guard (cloned from kairos-surprise-parity).
 *   - get_kairos_idea_taste <-> GET /api/v1/kairos/idea-taste
 * Both share lib/data/validators/kairos-idea-taste.ts, readIdeaTaste and the markdown renderer.
 * The outcomeBy stamp runs server-side on triage only; no MCP/REST file may import it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-idea-taste.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/idea-taste/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos idea taste MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only taste tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_idea_taste'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-idea-taste'")
      expect(src).toMatch(/\bgetKairosIdeaTasteSchema\b/)
    }
  })

  it('both surfaces call readIdeaTaste from the data layer', () => {
    const importRe = /import \{[^}]*\breadIdeaTaste\b[^}]*\} from '@\/lib\/data\/idea-taste'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderIdeaTasteMarkdown\b[^}]*\} from '@\/lib\/kairos\/ideas\/stepping\/taste-render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readIdeaTaste\(uid\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readIdeaTaste\(result\.id\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosIdeaTasteTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosIdeaTasteTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_idea_taste'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(stampIdeaOutcomeBy|recordIdeaOutcome)\b/

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

describe('Kairos idea outcomes are stamped by the server only', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports an idea-outcome writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports an idea-outcome writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { stampIdeaOutcomeBy } from '@/lib/data/idea-taste'"
    expect(importStatements(sample)[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
