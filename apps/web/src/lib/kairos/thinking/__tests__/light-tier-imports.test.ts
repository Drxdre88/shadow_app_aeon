/**
 * Fast/slow split (spec_stage §7): a light-tier handler only notices. It may
 * post to the stage and write today notes, but it must never import a
 * lasting writer — memories, aligned beliefs, goal transitions, predictions
 * or Horae bookings. Tier comes from BRAIN_JOBS, so a kind moved to 'light'
 * later is guarded automatically.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { BRAIN_JOBS } from '@/lib/kairos/routines/catalog'

const HANDLERS = path.resolve(__dirname, '../handlers')
const FORBIDDEN_IDENTIFIERS = /\b(captureMemory|writeAlignedBeliefs|createKairosPredictions|createAgendaItems)\b/
const FORBIDDEN_MODULES = /from\s+['"][^'"]*(goals\/transitions|predictions\/create|agenda\/create)['"]/

function importStatements(src: string): string[] {
  return src.match(/import[\s\S]*?from\s+['"][^'"]+['"]/g) ?? []
}

const handlerFile = (kind: string) => path.join(HANDLERS, `${kind.replace(/_/g, '-')}.ts`)
const lightKinds = BRAIN_JOBS.filter((j) => j.tier === 'light').map((j) => j.kind)

describe('light-tier handlers never import a lasting writer', () => {
  it('there is at least one light-tier kind (pulse)', () => {
    expect(lightKinds).toContain('pulse')
  })

  it.each(lightKinds)('%s', (kind) => {
    const file = handlerFile(kind)
    expect(existsSync(file), `no handler file for light kind ${kind}`).toBe(true)
    for (const stmt of importStatements(readFileSync(file, 'utf8'))) {
      expect(stmt, `${kind} imports a lasting writer`).not.toMatch(FORBIDDEN_IDENTIFIERS)
      expect(stmt, `${kind} imports a lasting writer module`).not.toMatch(FORBIDDEN_MODULES)
    }
  })

  it('the guard itself would catch an import', () => {
    for (const sample of [
      "import { captureMemory, listRecentMemories } from '@/lib/data/memories'",
      "import { writeAlignedBeliefs } from '@/lib/data/beliefs'",
      "import { proposeGoal } from '@/lib/kairos/goals/transitions'",
      "import { createKairosPredictions } from '@/lib/kairos/predictions/create'",
      "import { createAgendaItems } from '@/lib/kairos/agenda/create'",
    ]) {
      const stmt = importStatements(sample)[0]!
      expect(FORBIDDEN_IDENTIFIERS.test(stmt) || FORBIDDEN_MODULES.test(stmt), sample).toBe(true)
    }
  })
})
