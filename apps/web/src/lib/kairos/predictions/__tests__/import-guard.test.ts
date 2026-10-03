/**
 * Kairos never settles his own predictions. Nothing under the MCP transport,
 * the REST v1 surface (the GET route reads only) or the thinking queue may
 * import the verdict / check / mutate paths. lib/kairos/thinking may import
 * `create` (Kairos proposes; the server validates). Mirrors the guard in
 * kairos-promises-parity.test.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '../../../..')

const FORBIDDEN_ROOTS = ['app/api/[transport]', 'app/api/v1', 'lib/kairos/thinking']
const FORBIDDEN_IDENTIFIERS = /\b(settleKairosPredictionByOwner|settleOwnKairosPrediction|feedBackSettlement|mutateKairosPredictions|runPredictionSettlement|planPredictionChecks|routePredictionCommands)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(predictions\/(verdict|check|telegram-commands)|actions\/kairos-predictions)['"]/

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

describe('Kairos predictions are never settled by an agent', () => {
  it.each(FORBIDDEN_ROOTS)('nothing under %s imports a verdict / check / mutate path', (root) => {
    const files = sourceFiles(path.join(SRC, root))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const stmt of importStatements(readFileSync(file, 'utf8'))) {
        const rel = path.relative(SRC, file)
        expect(stmt, `${rel} imports a prediction settler`).not.toMatch(FORBIDDEN_IDENTIFIERS)
        expect(stmt, `${rel} imports a prediction settler module`).not.toMatch(FORBIDDEN_MODULES)
      }
    }
  })

  it('the thinking queue may create predictions (the weekly review does)', () => {
    const handler = readFileSync(path.join(SRC, 'lib/kairos/thinking/handlers/weekly-review.ts'), 'utf8')
    expect(handler).toMatch(/from '@\/lib\/kairos\/predictions\/create'/)
  })

  it('the read surfaces stay read-only', () => {
    const rest = readFileSync(path.join(SRC, 'app/api/v1/kairos/predictions/route.ts'), 'utf8')
    expect(rest).toMatch(/export const GET\b/)
    expect(rest).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
    const mcp = readFileSync(path.join(SRC, 'app/api/[transport]/tools/kairos-predictions.ts'), 'utf8')
    expect([...mcp.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])).toEqual(['list_kairos_predictions'])
    expect(mcp).toMatch(/readOnlyHint: true/)
  })

  it('the guard itself would catch an import', () => {
    const sample = "import { settleKairosPredictionByOwner } from '@/lib/kairos/predictions/verdict'"
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
    expect(importStatements(sample)[0]).toMatch(FORBIDDEN_MODULES)
    const mutate = "import { mutateKairosPredictions } from '@/lib/data/kairos-predictions'"
    expect(importStatements(mutate)[0]).toMatch(FORBIDDEN_IDENTIFIERS)
  })
})
