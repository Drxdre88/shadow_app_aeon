/**
 * Kairos predictions (track record) MCP <-> REST parity + settle guard.
 *
 * Mirrors kairos-promises-parity.test.ts. The prediction list and the score
 * are reachable identically from Claude (MCP) and external clients, read-only:
 *   - list_kairos_predictions <-> GET /api/v1/kairos/predictions
 * Both share lib/data/validators/kairos-predictions.ts, the same data fns and
 * the same pure scorer.
 *
 * Kairos creates, never settles: nothing under the MCP transport, the REST v1
 * surface or the thinking queue may import a verdict / check / mutate path.
 * The thinking queue may import only the server-side creator.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-predictions.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/predictions/route.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Kairos predictions MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only prediction tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['list_kairos_predictions'])
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
      expect(src).toContain("from '@/lib/data/validators/kairos-predictions'")
      expect(src).toMatch(/\blistKairosPredictionsSchema\b/)
    }
  })

  it.each(['listKairosPredictions', 'toKairosPredictionView'])('both surfaces call %s from the data layer', (fn) => {
    const importRe = new RegExp(`import \\{[^}]*\\b${fn}\\b[^}]*\\} from '@/lib/data/kairos-predictions'`)
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
  })

  it('both surfaces score the track record with the same pure scorer', () => {
    for (const src of [mcpSrc, restSrc]) {
      expect(src).toMatch(/import \{[^}]*\bscorePredictions\b[^}]*\} from '@\/lib\/kairos\/predictions\/score'/)
      expect(src).toMatch(/trackRecord: scorePredictions\(closed, new Date\(\)\)/)
    }
  })

  it('binds to the calling user on both surfaces', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/listKairosPredictions\(uid,/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/listKairosPredictions\(result\.id,/)
  })

  it('is exported, registered on the MCP server and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/export \{ registerKairosPredictionTools \} from '\.\/kairos-predictions'/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosPredictionTools, \[/)
    expect(read(MCP_DOCS)).toContain("'list_kairos_predictions'")
  })
})

const FORBIDDEN_ROOTS = ['app/api/[transport]', 'app/api/v1', 'lib/kairos/thinking']
const FORBIDDEN_IDENTIFIERS = /\b(settleKairosPredictionByOwner|settleOwnKairosPrediction|feedBackSettlement|mutateKairosPredictions|runPredictionSettlement|planPredictionChecks|routePredictionCommands|creditBackward)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(predictions\/(verdict|check|telegram-commands)|actions\/kairos-predictions|surprise\/credit)['"]/
const PREDICTION_MODULE = /from\s+['"]@\/lib\/kairos\/predictions\/([a-z-]+)['"]/
// What each guarded surface may import from lib/kairos/predictions.
const ALLOWED_PREDICTION_MODULES: Record<string, ReadonlySet<string>> = {
  'app/api/[transport]': new Set(['score']),
  'app/api/v1': new Set(['score']),
  'lib/kairos/thinking': new Set(['create', 'flag', 'prompt-block', 'score']),
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

describe('Kairos predictions are settled by the owner and the server only', () => {
  it.each(FORBIDDEN_ROOTS)('nothing under %s imports a verdict / check / mutate path', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const rel = path.relative(SRC, file)
      for (const stmt of importStatements(read(file))) {
        expect(stmt, `${rel} imports a prediction settler`).not.toMatch(FORBIDDEN_IDENTIFIERS)
        expect(stmt, `${rel} imports a prediction settler module`).not.toMatch(FORBIDDEN_MODULES)
        const mod = stmt.match(PREDICTION_MODULE)?.[1]
        if (mod) expect(ALLOWED_PREDICTION_MODULES[root].has(mod), `${rel} imports predictions/${mod}`).toBe(true)
      }
    }
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { settleKairosPredictionByOwner } from '@/lib/kairos/predictions/verdict'"
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_MODULES)
    expect(ALLOWED_PREDICTION_MODULES['lib/kairos/thinking'].has(importStatements(sample)[0].match(PREDICTION_MODULE)![1])).toBe(false)
  })
})
