/**
 * Goal → card tree MCP <-> REST <-> server action parity + "proposal only" guards.
 *
 * Styled on kairos-trust-parity.test.ts. Asking Vorath to plan a goal is
 * reachable identically from Claude (MCP), external clients and the board:
 *   - request_card_tree <-> POST /api/v1/kairos/card-tree <-> requestCardTreeAction
 * All three share lib/data/validators/kairos-card-tree.ts and requestCardTree.
 *
 * Guards: cards are created ONLY by the owner's approval (createCardTree is
 * imported by the card_tree decision kind and nothing else), and the handler
 * never reaches the server-action layer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SRC = path.join(WEB_ROOT, 'src')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/kairos-card-tree.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const REST_ROUTE = path.join(SRC, 'app/api/v1/kairos/card-tree/route.ts')
const ACTION_FILE = path.join(SRC, 'lib/actions/card-tree.ts')
const MCP_DOCS = path.join(SRC, 'components/ui/help/mcpToolCatalog.ts')
const HANDLER_FILE = path.join(SRC, 'lib/kairos/thinking/handlers/card-tree.ts')
const CARD_TREE_DIR = path.join(SRC, 'lib/kairos/card-tree')
const DECISION_FILE = path.join(CARD_TREE_DIR, 'decision.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolNames(src: string): string[] {
  return [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])
}

describe('Card tree MCP <-> REST <-> action parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)
  const restSrc = existsSync(REST_ROUTE) ? read(REST_ROUTE) : ''
  const actionSrc = existsSync(ACTION_FILE) ? read(ACTION_FILE) : ''

  it('exposes exactly one non-destructive request tool', () => {
    expect(toolNames(mcpSrc)).toEqual(['request_card_tree'])
    expect(mcpSrc).toMatch(/destructiveHint: false/)
    expect(mcpSrc).toMatch(/readOnlyHint: false/)
  })

  it('has the REST twin with POST only', () => {
    expect(existsSync(REST_ROUTE), 'missing REST route').toBe(true)
    expect(restSrc).toMatch(/export const POST\b/)
    expect(restSrc).not.toMatch(/export const (GET|PUT|PATCH|DELETE)\b/)
  })

  it('all three surfaces share the validator from the shared module', () => {
    for (const src of [mcpSrc, restSrc, actionSrc]) {
      expect(src).toContain("from '@/lib/data/validators/kairos-card-tree'")
      expect(src).toMatch(/\brequestCardTreeSchema\b/)
    }
  })

  it('all three surfaces call requestCardTree from the data layer with the parsed input', () => {
    const importRe = /import \{[^}]*\brequestCardTree\b[^}]*\} from '@\/lib\/data\/card-tree'/
    for (const src of [mcpSrc, restSrc, actionSrc]) expect(src).toMatch(importRe)
    expect(mcpSrc).toMatch(/requestCardTree\(uid, parsed\.data\)/)
    expect(restSrc).toMatch(/requestCardTree\(result\.id, parsed\.data\)/)
    expect(actionSrc).toMatch(/requestCardTree\(userId, parsed\.data\)/)
  })

  it('binds to the calling user on every surface; the action keeps the editor guard', () => {
    expect(mcpSrc).toMatch(/getUserId\(extra\)/)
    expect(restSrc).toMatch(/authenticateRequest\(/)
    expect(restSrc).toMatch(/isApiUser\(result\)/)
    expect(actionSrc).toMatch(/^'use server'/)
    expect(actionSrc).toMatch(/await requireEditor\(projectId\)/)
  })

  it('is registered on the MCP server (Vorath profile) and documented', () => {
    expect(read(MCP_INDEX)).toMatch(/registerKairosCardTreeTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerKairosCardTreeTools, \['vorath'\]\]/)
    expect(read(MCP_DOCS)).toContain("'request_card_tree'")
  })
})

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('Card trees stay proposal-only', () => {
  it('only the card_tree decision kind imports createCardTree', () => {
    const importers = sourceFiles(SRC).filter((file) =>
      file !== path.join(SRC, 'lib/data/card-tree.ts')
      && importStatements(read(file)).some((s) => /\bcreateCardTree\b/.test(s)))
    expect(importers.map((f) => path.relative(SRC, f).split(path.sep).join('/'))).toEqual(['lib/kairos/card-tree/decision.ts'])
    expect(read(DECISION_FILE)).toMatch(/async approve\(/)
  })

  it.each([HANDLER_FILE, ...sourceFiles(CARD_TREE_DIR)].map((f) => [path.relative(SRC, f).split(path.sep).join('/'), f]))('%s never imports server actions', (_rel, file) => {
    for (const stmt of importStatements(read(file))) expect(stmt, `${_rel}: ${stmt}`).not.toMatch(/['"]@\/lib\/actions\//)
  })

  it('the handler has no paid fallback and plans nothing', () => {
    const src = read(HANDLER_FILE)
    expect(src).toMatch(/plan: async \(\): Promise<ThinkingJobSpec\[\]> => \[\]/)
    expect(src).toMatch(/fallback: async \(\): Promise<ApplyOutcome> => \(\{ ok: false/)
  })
})
