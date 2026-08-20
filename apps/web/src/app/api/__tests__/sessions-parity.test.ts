/**
 * Sessions + Hangar registry MCP <-> REST parity test.
 *
 * The MCP server and REST API must expose the SAME agent-session and Hangar
 * registry capabilities, so a runner or external integration never sees a
 * surface that only one transport supports. This test statically verifies:
 *   - every session / registry MCP tool has a matching REST route file on disk
 *   - every REST route exports the expected methods
 *   - both surfaces import the same validators from `@/lib/data/validators`
 *   - both surfaces call the same data-layer functions
 *   - both surfaces authenticate (sessions are user-scoped; the registry is
 *     additionally realm-gated on both sides)
 *
 * Fails loudly if either side drifts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const SESSION_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/sessions.ts')
const HANGAR_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/hangar.ts')
const TRANSPORT_ROUTE = path.join(WEB_ROOT, 'src/app/api/[transport]/route.ts')
const SESSION_REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/sessions')
const HANGAR_REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/hangar-repos')

const SESSION_REST_FILES = [
  'route.ts',
  '[id]/route.ts',
  '[id]/events/route.ts',
  '[id]/kill/route.ts',
  'claim/route.ts',
  '[id]/heartbeat/route.ts',
]

const HANGAR_REST_FILES = ['route.ts', '[id]/route.ts']

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

describe('Sessions MCP <-> REST parity', () => {
  const mcpSrc = readSource(SESSION_TOOL_FILE)
  const toolNames = extractToolNames(mcpSrc)
  const restSrcConcat = SESSION_REST_FILES
    .map((p) => readSource(path.join(SESSION_REST_ROOT, p)))
    .join('\n')

  describe('MCP tool surface', () => {
    it('exposes every expected session operation', () => {
      expect(new Set(toolNames)).toEqual(new Set([
        'spawn_session',
        'list_sessions',
        'get_session',
        'list_session_events',
        'kill_session',
        'claim_session',
      ]))
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      { path: 'route.ts', methods: ['GET', 'POST'] },
      { path: '[id]/route.ts', methods: ['GET', 'PATCH'] },
      { path: '[id]/events/route.ts', methods: ['GET', 'POST'] },
      { path: '[id]/kill/route.ts', methods: ['POST'] },
      { path: 'claim/route.ts', methods: ['POST'] },
      { path: '[id]/heartbeat/route.ts', methods: ['POST'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(SESSION_REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = readSource(full)
      for (const m of methods) {
        expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })
  })

  describe('shared validator usage — MCP and REST speak the same schema', () => {
    const sharedValidators = ['spawnSessionSchema', 'listSessionsSchema', 'claimSessionSchema']

    // Ingest-only schemas: the worker host and Claude Code hooks post status
    // and event rows over REST. There is deliberately no MCP tool for them —
    // an agent reads its own transcript, it doesn't rewrite it.
    const restOnlyValidators = ['updateSessionStatusSchema', 'recordSessionEventSchema']

    it.each(sharedValidators)('MCP uses validator: %s', (v) => {
      expect(mcpSrc, `MCP sessions.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it.each([...sharedValidators, ...restOnlyValidators])('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })
  })

  describe('data-function parity — MCP and REST call the same underlying functions', () => {
    const dataFns = [
      'createAgentSession',
      'listAgentSessions',
      'findAgentSessionById',
      'listSessionEvents',
      'updateAgentSessionStatus',
      'claimNextSession',
    ]

    it.each(dataFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(dataFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })
  })

  describe('auth enforcement — sessions are user-scoped on both surfaces', () => {
    it('every session REST route authenticates the caller', () => {
      for (const r of SESSION_REST_FILES) {
        const src = readSource(path.join(SESSION_REST_ROOT, r))
        expect(src, `${r} missing authenticateRequest`).toMatch(/authenticateRequest\(/)
      }
    })

    it('every MCP session tool resolves the calling user', () => {
      const toolBlocks = mcpSrc.split(/server\.tool\(/).slice(1)
      for (const block of toolBlocks) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing getUserId check`).toMatch(/getUserId\(/)
      }
    })

    // Resolving the user isn't enough for claim: the queue is shared with other
    // users' missions, so the id has to reach the claim predicate itself.
    it('claim_session scopes the claim to the calling user on both surfaces', () => {
      const mcpClaimBlock = mcpSrc.split(/server\.tool\(/).slice(1)
        .find((b) => b.match(/['"]([a-z_]+)['"]/)?.[1] === 'claim_session')
      expect(mcpClaimBlock, 'claim_session tool not found').toBeDefined()
      expect(mcpClaimBlock!, 'MCP claim_session must pass the resolved user into claimNextSession')
        .toMatch(/claimNextSession\(\s*(uid|userId)\b/)

      const restClaimSrc = readSource(path.join(SESSION_REST_ROOT, 'claim/route.ts'))
      expect(restClaimSrc, 'REST claim route must pass the authenticated user into claimNextSession')
        .toMatch(/claimNextSession\(\s*auth\.id\b/)
    })
  })
})

describe('Hangar registry MCP <-> REST parity', () => {
  const mcpSrc = readSource(HANGAR_TOOL_FILE)
  const toolNames = extractToolNames(mcpSrc)
  const restSrcConcat = HANGAR_REST_FILES
    .map((p) => readSource(path.join(HANGAR_REST_ROOT, p)))
    .join('\n')

  describe('MCP tool surface', () => {
    it('exposes every expected registry operation', () => {
      expect(new Set(toolNames)).toEqual(new Set([
        'register_repo',
        'list_repos',
        'update_repo',
        'delete_repo',
      ]))
    })

    it('is registered on the MCP server', () => {
      const transportSrc = readSource(TRANSPORT_ROUTE)
      expect(transportSrc).toMatch(/registerHangarTools\(server\)/)
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      { path: 'route.ts', methods: ['GET', 'POST'] },
      { path: '[id]/route.ts', methods: ['GET', 'PUT', 'DELETE'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(HANGAR_REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = readSource(full)
      for (const m of methods) {
        expect(src, `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })
  })

  describe('shared validator usage — MCP and REST speak the same schema', () => {
    const validators = ['createHangarRepoSchema', 'updateHangarRepoSchema']

    it.each(validators)('MCP uses validator: %s', (v) => {
      expect(mcpSrc, `MCP hangar.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it.each(validators)('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })
  })

  describe('data-function parity — MCP and REST call the same underlying functions', () => {
    const dataFns = ['createHangarRepo', 'listHangarRepos', 'findHangarRepoById', 'updateHangarRepo']

    it.each(dataFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(dataFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })
  })

  describe('realm gating — the registry is member-scoped on both surfaces', () => {
    it('every MCP registry tool resolves the caller and checks realm role', () => {
      const toolBlocks = mcpSrc.split(/server\.tool\(/).slice(1)
      for (const block of toolBlocks) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing getUserId check`).toMatch(/getUserId\(/)
        expect(block, `MCP tool ${name} missing realm role check`)
          .toMatch(/getGroupRole\(|requireRealmEditor\(/)
      }
    })

    it('every registry REST route authenticates and checks realm role', () => {
      for (const r of HANGAR_REST_FILES) {
        const src = readSource(path.join(HANGAR_REST_ROOT, r))
        expect(src, `${r} missing authenticateRequest`).toMatch(/authenticateRequest\(/)
        expect(src, `${r} missing getGroupRole`).toMatch(/getGroupRole\(/)
      }
    })
  })
})
