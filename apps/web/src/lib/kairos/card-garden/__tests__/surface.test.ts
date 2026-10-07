import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The gardener is app/Telegram only: no MCP tool or REST route reaches it,
// and only its decision kind can apply an approved action to a card.

const SRC = path.resolve(__dirname, '../../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('card garden surfaces', () => {
  it('no MCP tool or REST route imports the card garden', () => {
    const offenders = sourceFiles(path.join(SRC, 'app/api'))
      .filter((f) => /card-garden|card_garden|CardGarden/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })

  it('only the card_garden decision kind applies an approved action', () => {
    const users = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('lib', 'data', 'card-garden-proposals.ts')))
      .filter((f) => /\bapplyCardGardenDecision\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
    expect(users).toEqual(['lib/kairos/card-garden/decision.ts'])
  })
})
