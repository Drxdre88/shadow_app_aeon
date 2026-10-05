/**
 * Kairos owner model MCP <-> REST parity + owner-only writer guard.
 *
 * Cloned from kairos-surprise-parity.test.ts. The owner model is reachable
 * identically from Claude (MCP) and external clients, read-only:
 *   - get_kairos_owner_model <-> GET /api/v1/kairos/owner-model
 * Both share lib/data/validators/kairos-owner-model.ts and the same data fns.
 *
 * No agent write path: nothing under the MCP transport or the REST v1 surface
 * may import an owner-model writer — only the owner corrects it (Telegram and
 * the web session), and only belief_extract extends it.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-owner-model.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/owner-model/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos owner model MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only owner-model tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_kairos_owner_model'])
    expect(mcpSrc).toMatch(/readOnlyHint: true/)
  })

  it('has the REST twin with GET only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const GET\b/)
    expect(restSrc).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
  })

  it('both surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-owner-model'")
      expect(src).toMatch(/\bgetKairosOwnerModelSchema\b/)
    }
  })

  it.each(['readKairosOwnerModel', 'toKairosOwnerModelView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-owner-model'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces render markdown with the same pure renderer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\brenderOwnerModelMarkdown\b[^}]*\} from '@\/lib\/kairos\/owner-model\/render'/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/readKairosOwnerModel\(uid\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/readKairosOwnerModel\(result\.id\)/)
  })

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosOwnerModelTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosOwnerModelTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_owner_model'")
  })
})

const GUARDED_ROOTS = ['app/api/[transport]', 'app/api/v1']
const WRITER_IDENTIFIERS = /\b(mutateKairosOwnerModel|correctOwnerItem|applyOwnerCorrection|applyOwnerExtract|mergeOwnerExtraction)\b|owner-model\/(correct|apply|mutations|telegram-commands|callback|card-sweep)['"]/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('Kairos owner model has no agent write path', () => {
  it.each(GUARDED_ROOTS)('nothing under %s imports an owner-model writer', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join('/')
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports an owner-model writer`).not.toMatch(WRITER_IDENTIFIERS)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    expect(importStatements("import { correctOwnerItem } from '@/lib/kairos/owner-model/correct'")[0]).toMatch(WRITER_IDENTIFIERS)
    expect(importStatements("import { x } from '@/lib/kairos/owner-model/mutations'")[0]).toMatch(WRITER_IDENTIFIERS)
  })

  it('the guard also catches dynamic imports', () => {
    const samples = [
      "const { correctOwnerItem } = await import('@/lib/kairos/owner-model/correct')",
      "const data = await import('@/lib/kairos/owner-model/correct')\nawait data.correctOwnerItem(userId)",
      "await (await import('@/lib/kairos/owner-model/correct')).correctOwnerItem(userId)",
      "import('@/lib/kairos/owner-model/correct').then(({ correctOwnerItem }) => correctOwnerItem())",
    ]
    for (const s of samples) expect(importStatements(s).join('\n')).toMatch(WRITER_IDENTIFIERS)
  })
})
