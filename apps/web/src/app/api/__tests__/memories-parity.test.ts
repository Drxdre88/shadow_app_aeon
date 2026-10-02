/**
 * Memory MCP <-> REST parity test.
 *
 * Mirrors gantt-parity.test.ts. The brain layer must expose the SAME memory
 * capabilities through both surfaces so Claude (MCP) and external clients
 * (REST) never diverge. This test statically verifies:
 *   - exactly the four expected MCP tools are registered
 *   - every MCP-exposed capability has a matching REST route file + method
 *   - both surfaces import the same validators from `@/lib/data/validators`
 *   - both surfaces call the same data functions from `@/lib/data/memories`
 *   - every mutation enforces userId ownership through the data layer's
 *     user-scoped queries (authenticated through authenticateRequest /
 *     getUserId)
 *
 * Documented exclusions (REST-only — no MCP counterpart by design):
 *   - DELETE /memories/[id]          (admin-y; AI rarely needs to delete)
 *   - PATCH  /memories/[id]          (admin-y)
 *   - GET    /memories               (paginated list — AI uses search instead)
 *   - GET    /memories/[id]          (single-fetch — AI uses search/neighbours)
 *   - DELETE /memories/[id]/links/[linkIndex]  (edge cleanup is admin)
 *   - GET    /memories/[id]/export   (markdown export)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/memories.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/memories')

const REST_ROUTE_FILES = [
  'route.ts',
  '[id]/route.ts',
  'search/route.ts',
  'context/route.ts',
  '[id]/links/route.ts',
  '[id]/links/[linkIndex]/route.ts',
  '[id]/neighbours/route.ts',
  '[id]/trail/route.ts',
  '[id]/export/route.ts',
  '[id]/accept/route.ts',
  'needs-summary/route.ts',
]

function readSource(p: string): string {
  return readFileSync(p, 'utf8')
}

function extractToolNames(src: string): string[] {
  const re = /server\.tool\(\s*['"]([a-z_]+)['"]/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names
}

describe('Memory MCP <-> REST parity', () => {
  const mcpSrc = readSource(MCP_TOOL_FILE)
  const toolNames = extractToolNames(mcpSrc)
  const restSrcConcat = REST_ROUTE_FILES
    .map((p) => readSource(path.join(REST_ROOT, p)))
    .join('\n')

  describe('MCP tool surface', () => {
    it('exposes exactly the nine expected memory operations', () => {
      expect(new Set(toolNames)).toEqual(new Set([
        'create_memory',
        'update_memory',
        'search_memories',
        'link_memory',
        'get_memory_with_neighbours',
        'get_belief_trail',
        'prepare_context',
        'list_memories_needing_summary',
        'accept_proposal',
      ]))
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      { path: 'route.ts',                          methods: ['GET', 'POST'] },
      { path: '[id]/route.ts',                     methods: ['GET', 'PATCH', 'DELETE'] },
      { path: 'search/route.ts',                   methods: ['GET'] },
      { path: 'context/route.ts',                  methods: ['GET'] },
      { path: '[id]/links/route.ts',               methods: ['POST'] },
      { path: '[id]/links/[linkIndex]/route.ts',   methods: ['DELETE'] },
      { path: '[id]/neighbours/route.ts',          methods: ['GET'] },
      { path: '[id]/trail/route.ts',               methods: ['GET'] },
      { path: '[id]/export/route.ts',              methods: ['GET'] },
      { path: '[id]/accept/route.ts',              methods: ['POST'] },
      { path: 'needs-summary/route.ts',            methods: ['GET'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = readSource(full)
      for (const m of methods) {
        expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })
  })

  describe('shared validator usage — MCP and REST speak the same schema', () => {
    const validators = [
      'createMemorySchema',
      'updateMemorySchema',
      'searchMemoriesSchema',
      'addLinkSchema',
      'getNeighboursSchema',
      'getBeliefTrailSchema',
      'prepareContextSchema',
      'acceptProposalSchema',
    ]

    it.each(validators)('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    // MCP uses every validator that has an MCP counterpart. update_memory
    // was added in the Kairos rebrand to support backfilling AI-generated
    // aiTitle + execSummary fields on existing memories via Claude Code.
    const mcpValidators = [
      'createMemorySchema',
      'updateMemorySchema',
      'searchMemoriesSchema',
      'addLinkSchema',
      'getNeighboursSchema',
      'getBeliefTrailSchema',
      'prepareContextSchema',
      'acceptProposalSchema',
    ]
    it.each(mcpValidators)('MCP tool file uses validator: %s', (v) => {
      expect(mcpSrc, `MCP memories.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })
  })

  describe('data-function parity — MCP and REST call the same underlying functions', () => {
    const sharedFns = [
      'createMemory',
      'updateMemory',
      'searchMemoriesFts',
      'addLink',
      'findMemoryById',
      'getNeighbours',
      'getBeliefTrail',
      'prepareContext',
      'listMemoriesNeedingSummary',
      'acceptKairosProposal',
    ]

    it.each(sharedFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(sharedFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })
  })

  describe('user-scope enforcement — every tool + route binds to the calling user', () => {
    it('every MCP tool calls getUserId(extra)', () => {
      const toolBlocks = mcpSrc.split(/server\.tool\(/).slice(1)
      for (const block of toolBlocks) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing getUserId(extra) call`)
          .toMatch(/getUserId\(extra\)/)
      }
    })

    it('every REST route authenticates via authenticateRequest', () => {
      for (const r of REST_ROUTE_FILES) {
        const src = readSource(path.join(REST_ROOT, r))
        expect(src, `${r} missing authenticateRequest`)
          .toMatch(/authenticateRequest\(/)
      }
    })

    it('every REST route checks isApiUser before reading result.id', () => {
      for (const r of REST_ROUTE_FILES) {
        const src = readSource(path.join(REST_ROOT, r))
        expect(src, `${r} missing isApiUser narrow`)
          .toMatch(/isApiUser\(result\)/)
      }
    })
  })

  // docs/kairos/34 §2: agent surfaces may not accept a constitution amendment
  // — only the operator (Aeon inbox session / Telegram) can. Both surfaces
  // refuse it with the same shared guard + message before acceptProposal.
  describe('constitution amendments are operator-only on both surfaces', () => {
    const acceptBlock = mcpSrc.split(/server\.tool\(/).find((b) => /^\s*['"]accept_proposal['"]/.test(b)) ?? ''
    const restAccept = readSource(path.join(REST_ROOT, '[id]/accept/route.ts'))

    it.each([
      ['MCP accept_proposal', acceptBlock],
      ['REST POST [id]/accept', restAccept],
    ])('%s refuses kind constitution_amendment before accepting', (_label, src) => {
      expect(src).toMatch(/isConstitutionAmendmentProposal\(/)
      expect(src).toMatch(/OPERATOR_ONLY_AMENDMENT_ERROR/)
      expect(src.indexOf('isConstitutionAmendmentProposal(')).toBeLessThan(src.search(/acceptKairosProposal\(/))
    })

    it('both import the guard from the constitution amendment module', () => {
      for (const src of [mcpSrc, restAccept]) {
        expect(src).toMatch(/import \{[^}]*\bisConstitutionAmendmentProposal\b[^}]*\} from '@\/lib\/kairos\/constitution\/amendment'/)
      }
    })
  })

  // Phase 1 (constitution archive guard): agent surfaces may not archive,
  // retype, rewrite, delete or supersede a constitution row. Each refuses with
  // the shared helper + message BEFORE the data-layer mutation.
  describe('constitution rows are owner-only on agent surfaces', () => {
    const blockFor = (name: string) =>
      mcpSrc.split(/server\.tool\(/).find((b) => new RegExp(`^\\s*['"]${name}['"]`).test(b)) ?? ''
    const updateBlock = blockFor('update_memory')
    const acceptBlock = blockFor('accept_proposal')
    const restItem = readSource(path.join(REST_ROOT, '[id]/route.ts'))
    const restPatch = restItem.slice(restItem.indexOf('export const PATCH'), restItem.indexOf('export const DELETE'))
    const restDelete = restItem.slice(restItem.indexOf('export const DELETE'))
    const restAccept = readSource(path.join(REST_ROOT, '[id]/accept/route.ts'))

    it.each([
      ['MCP update_memory', updateBlock, /constitutionPatchRefusal\(/, /_updateMemory\(/],
      ['REST PATCH [id]', restPatch, /constitutionPatchRefusal\(/, /_updateMemory\(/],
      ['REST DELETE [id]', restDelete, /isConstitutionRow\(/, /_deleteMemory\(/],
    ] as const)('%s checks the constitution guard before mutating', (_label, src, guard, mutation) => {
      expect(src.search(guard)).toBeGreaterThan(-1)
      expect(src.search(guard)).toBeLessThan(src.search(mutation))
    })

    it.each([
      ['MCP accept_proposal', acceptBlock],
      ['REST POST [id]/accept', restAccept],
    ])('%s refuses superseding a constitution row before accepting', (_label, src) => {
      expect(src).toMatch(/supersedes/)
      expect(src).toMatch(/OPERATOR_ONLY_CONSTITUTION_EDIT_ERROR/)
      expect(src.search(/isConstitutionRow\b/)).toBeGreaterThan(-1)
      expect(src.search(/isConstitutionRow\b/)).toBeLessThan(src.search(/acceptKairosProposal\(/))
    })

    it('all surfaces import the guard from the constitution amendment module', () => {
      for (const src of [mcpSrc, restItem, restAccept]) {
        expect(src).toMatch(/import \{[^}]*\bisConstitutionRow\b[^}]*\} from '@\/lib\/kairos\/constitution\/amendment'/)
      }
    })

    it('the update_memory description tells agents constitution rows are owner-only', () => {
      expect(updateBlock).toMatch(/Constitution rows are owner-only/)
    })
  })

  // Phase 2: Kairos goal rows (pending proposals and approved goals) are
  // owner-decided. Agent surfaces refuse archiving (= veto), retyping,
  // rewriting or deleting one, with the shared goal guard, before mutating.
  describe('Kairos goal rows are owner-only on agent surfaces', () => {
    const blockFor = (name: string) =>
      mcpSrc.split(/server\.tool\(/).find((b) => new RegExp(`^\\s*['"]${name}['"]`).test(b)) ?? ''
    const updateBlock = blockFor('update_memory')
    const restItem = readSource(path.join(REST_ROOT, '[id]/route.ts'))
    const restPatch = restItem.slice(restItem.indexOf('export const PATCH'), restItem.indexOf('export const DELETE'))
    const restDelete = restItem.slice(restItem.indexOf('export const DELETE'))

    it.each([
      ['MCP update_memory', updateBlock, /goalPatchRefusal\(/, /_updateMemory\(/],
      ['REST PATCH [id]', restPatch, /goalPatchRefusal\(/, /_updateMemory\(/],
      ['REST DELETE [id]', restDelete, /isGoalRow\(/, /_deleteMemory\(/],
    ] as const)('%s checks the goal guard before mutating', (_label, src, guard, mutation) => {
      expect(src.search(guard)).toBeGreaterThan(-1)
      expect(src.search(guard)).toBeLessThan(src.search(mutation))
    })

    it('REST DELETE refuses goal rows with the shared message', () => {
      expect(restDelete).toMatch(/OPERATOR_ONLY_GOAL_ERROR/)
    })

    it('all surfaces import the guard from the goals guard module', () => {
      expect(mcpSrc).toMatch(/import \{[^}]*\bgoalPatchRefusal\b[^}]*\} from '@\/lib\/kairos\/goals\/guards'/)
      expect(restItem).toMatch(/import \{[^}]*\bgoalPatchRefusal\b[^}]*\bisGoalRow\b[^}]*\} from '@\/lib\/kairos\/goals\/guards'/)
    })

    it('the update_memory description tells agents goal rows are owner-only', () => {
      expect(updateBlock).toMatch(/Kairos goal rows .* are owner-only/)
    })

    // Track C: accepting a goal = approving it, owner-only.
    it.each([
      ['MCP accept_proposal', blockFor('accept_proposal')],
      ['REST POST [id]/accept', readSource(path.join(REST_ROOT, '[id]/accept/route.ts'))],
    ])('%s refuses a goal row with OPERATOR_ONLY_GOAL_ERROR before accepting', (_label, src) => {
      expect(src).toMatch(/OPERATOR_ONLY_GOAL_ERROR/)
      expect(src.search(/isGoalRow\(/)).toBeGreaterThan(-1)
      expect(src.search(/isGoalRow\(/)).toBeLessThan(src.search(/acceptKairosProposal\(/))
    })
  })
})
