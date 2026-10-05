/**
 * Kairos idea atlas MCP <-> REST parity + server-only writer guard.
 *
 * Mirrors kairos-stage-parity.test.ts. The idea atlas is reachable identically
 * from Claude (MCP) and external clients, read-only:
 *   - get_kairos_idea_atlas <-> GET /api/v1/kairos/idea-atlas
 * Both share lib/data/validators/kairos-idea-atlas.ts and the same data fns.
 *
 * Server-only writes: nothing under the MCP transport or the REST v1 surface
 * may import the atlas writer — only the nightly idea judge updates it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-idea-atlas.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/idea-atlas/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos idea atlas MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only atlas tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_idea_atlas'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-idea-atlas'")
      expect(src).toMatch(/\bgetKairosIdeaAtlasSchema\b/)
    }
  })

  it('both surfaces read through the same data fns and pure view', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\breadKairosIdeaAtlas\b[^}]*\} from '@\/lib\/data\/kairos-idea-atlas'/)
      expect(src).toMatch(/import \{[^}]*\blistActiveDominions\b[^}]*\} from '@\/lib\/data\/idea-inputs'/)
      expect(src).toMatch(/import \{[^}]*\btoIdeaAtlasView\b[^}]*\brenderIdeaAtlasMarkdown\b|import \{[^}]*\brenderIdeaAtlasMarkdown\b[^}]*\btoIdeaAtlasView\b/)
      expect(src).toContain("from '@/lib/kairos/ideas/atlas/view'")
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readKairosIdeaAtlas\(uid\)/)
    expect(mcpSrc).toMatch(/listActiveDominions\(uid\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readKairosIdeaAtlas\(result\.id\)/)
    expect(restSrc).toMatch(/listActiveDominions\(result\.id\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosIdeaAtlasTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosIdeaAtlasTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_idea_atlas'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(mutateKairosIdeaAtlas|applyAtlasNight)\b/

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

describe('Kairos idea atlas is written by the server only', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports an atlas writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports an atlas writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { mutateKairosIdeaAtlas } from '@/lib/data/kairos-idea-atlas'"
    expect(importStatements(sample)[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
