/**
 * Card forecast MCP <-> REST parity + read-only guards (P3-2).
 *
 * Styled on kairos-trust-parity.test.ts:
 *   - get_card_forecast <-> GET /api/v1/projects/[id]/forecast
 * Both share lib/data/validators/card-forecast.ts and readCardForecasts.
 *
 * Guards: the forecast is worked out on read. Nothing in the pure module,
 * the data fn, the action or either surface may import Vorath's predictions,
 * a writer, or the Chronos solve (which can persist placements).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/card-forecast.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/projects/[id]/forecast/route.ts')
const DATA_FILE = path.join(SRC, 'lib/data/card-forecast.ts')
const PURE_FILE = path.join(SRC, 'lib/schedule/forecast.ts')
const ACTION_FILE = path.join(SRC, 'lib/actions/card-forecast.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Card forecast MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''

  it('exposes exactly one read-only forecast tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['get_card_forecast'])
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
      expect(src).toContain("from '@/lib/data/validators/card-forecast'")
      expect(src).toMatch(/\bgetCardForecastSchema\b/)
    }
  })

  it('both surfaces call readCardForecasts with the parsed project and task', () => {
    const importRe = /import \{[^}]*\breadCardForecasts\b[^}]*\} from '@\/lib\/data\/card-forecast'/
    expect(mcpSrc).toMatch(importRe)
    expect(restSrc).toMatch(importRe)
    expect(mcpSrc).toMatch(/readCardForecasts\(parsed\.data\.projectId, uid, \{ taskId: parsed\.data\.taskId \}\)/)
    expect(restSrc).toMatch(/readCardForecasts\(parsed\.data\.projectId, result\.id, \{ taskId: parsed\.data\.taskId \}\)/)
  })

  it('binds to the calling user and hides projects they cannot see', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(mcpSrc).toMatch(/if \(!view\) return notFound\('Project'\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(restSrc).toMatch(/if \(!view\) return jsonError\('Project not found', 404\)/)
  })

  it('the data fn checks project access before reading', () => {
    const data = read(DATA_FILE)
    expect(data).toMatch(/import \{ verifyProjectAccess \} from '\.\/projects'/)
    expect(data).toMatch(/if \(!\(await verifyProjectAccess\(projectId, userId\)\)\) return null/)
  })

  it('the server action requires membership', () => {
    const action = read(ACTION_FILE)
    expect(action).toMatch(/^'use server'/)
    expect(action).toMatch(/await requireMember\(input\.projectId\)/)
  })

  it('is registered on the MCP server under the board profile', () => {
    expect(read(MCP_INDEX)).toMatch(/registerCardForecastTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerCardForecastTools, \['board'\]\]/)
  })
})

const FORBIDDEN_MODULES = /['"][^'"]*(predictions|solve-project|\/actions\/schedule)[^'"]*['"]/
const WRITER_IDENTIFIERS = /\b(mutate\w*|settle\w*|persist\w*|ensure\w*|solveProject\w*|create\w*Prediction\w*)\b/

const guardedFiles = [PURE_FILE, DATA_FILE, ACTION_FILE, MCP_TOOL_FILE, REST_ROUTE]

describe('Card forecast stays read-only and away from predictions', () => {
  it('guards the pure module, the data fn, the action and both surfaces', () => {
    for (const file of guardedFiles) expect(existsSync(file), file).toBe(true)
  })

  it.each(guardedFiles.map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s imports no prediction, solve or writer', (_rel, file) => {
    for (const stmt of importStatements(read(file))) {
      expect(stmt, `${_rel}: ${stmt}`).not.toMatch(FORBIDDEN_MODULES)
      expect(stmt, `${_rel}: ${stmt}`).not.toMatch(WRITER_IDENTIFIERS)
    }
  })

  it('the data fn issues no insert, update or delete', () => {
    expect(read(DATA_FILE)).not.toMatch(/\.(insert|update|delete)\(/)
  })

  it('the guard itself would catch each forbidden import', () => {
    const samples = [
      "import { listKairosPredictions } from '@/lib/data/kairos-predictions'",
      "import { createPrediction } from '@/lib/kairos/predictions/create'",
      "import { solveProjectSchedule } from '@/lib/schedule/solve-project'",
      "import { solveProject } from '@/lib/actions/schedule'",
    ]
    for (const s of samples) expect(importStatements(s)[0]).toMatch(FORBIDDEN_MODULES)
    expect(importStatements("import { persistPlacements } from '@/lib/data/schedule'")[0]).toMatch(WRITER_IDENTIFIERS)
  })
})
