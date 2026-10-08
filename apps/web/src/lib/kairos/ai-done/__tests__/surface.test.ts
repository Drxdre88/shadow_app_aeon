import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// AI DONE cards are written only by the ai_done thinking handler: no MCP tool
// or REST route reaches the writer or the switch.

const SRC = path.resolve(__dirname, '../../../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')

describe('AI DONE surfaces', () => {
  it('no MCP tool or REST route imports AI DONE', () => {
    const offenders = sourceFiles(path.join(SRC, 'app/api'))
      .filter((f) => /ai-done|ai_done|AiDone|kairosAiDone/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('only the ai_done handler calls the card writer', () => {
    const users = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('lib', 'data', 'ai-done.ts')))
      .filter((f) => /\bwriteAiDoneCards\b/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(users).toEqual(['lib/kairos/thinking/handlers/ai-done.ts'])
  })

  it('only the app action flips the per-board switch', () => {
    const users = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('lib', 'data', 'ai-done.ts')))
      .filter((f) => /\bsetProjectAiDone\b/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(users).toEqual(['lib/actions/ai-done.ts'])
  })
})
