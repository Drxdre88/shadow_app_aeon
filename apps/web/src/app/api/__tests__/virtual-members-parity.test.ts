/**
 * Virtual-member MCP <-> REST parity test.
 *
 * Virtual members are realm-scoped people without an Aeon account. Three
 * surfaces write them — server actions (the board overlay), REST v1, and the
 * MCP tools — and the MCP/REST pair must stay 1:1 so an agent and an external
 * integration never see different capabilities. Modelled on gantt-parity.
 *
 * This also PINS one deliberate asymmetry rather than pretending it away:
 * the board server action requires project-editor rights AND that the member
 * is reachable from that project, on top of realm-editor rights for delete;
 * REST/MCP address the realm directly and require realm rights only. Both are
 * safe; they are different doors, and the test says so out loud.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/virtual-members.ts')
const MCP_TOOL_INDEX = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/index.ts')
const MCP_TRANSPORT_ROUTE = path.join(WEB_ROOT, 'src/app/api/[transport]/route.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/realms/[realmId]/virtual-members')
const ACTIONS_FILE = path.join(WEB_ROOT, 'src/lib/actions/virtual-members.ts')

const REST_COLLECTION = 'route.ts'
const REST_ITEM = path.join('[virtualMemberId]', 'route.ts')
const REST_ROUTE_FILES = [REST_COLLECTION, REST_ITEM]

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

function toolBlock(src: string, name: string): string {
  const block = src.split(/server\.tool\(/).slice(1).find((b) => b.trimStart().startsWith(`'${name}'`))
  if (!block) throw new Error(`MCP tool not found: ${name}`)
  return block
}

const mcpSrc = readSource(MCP_TOOL_FILE)
const restSrc: Record<string, string> = Object.fromEntries(
  REST_ROUTE_FILES.map((p) => [p, readSource(path.join(REST_ROOT, p))]),
)
const restSrcConcat = Object.values(restSrc).join('\n')
const actionsSrc = readSource(ACTIONS_FILE)

describe('Virtual members MCP <-> REST parity', () => {
  describe('MCP tool surface', () => {
    it('exposes exactly the four virtual-member operations', () => {
      expect(new Set(extractToolNames(mcpSrc))).toEqual(new Set([
        'list_virtual_members',
        'create_virtual_member',
        'update_virtual_member',
        'delete_virtual_member',
      ]))
    })

    it('is actually wired into the transport — an unregistered tool file is invisible', () => {
      expect(readSource(MCP_TOOL_INDEX)).toMatch(/registerVirtualMemberTools/)
      const routeSrc = readSource(MCP_TRANSPORT_ROUTE)
      expect(routeSrc).toMatch(/registerVirtualMemberTools/)
      expect(routeSrc).toMatch(/registerVirtualMemberTools\(server\)/)
    })

    // MCP clients gate confirmation prompts on these — a delete advertised as
    // non-destructive gets auto-approved by an agent.
    it('annotates the destructive tool as destructive and the read as read-only', () => {
      expect(toolBlock(mcpSrc, 'delete_virtual_member')).toMatch(/destructiveHint:\s*true/)
      expect(toolBlock(mcpSrc, 'list_virtual_members')).toMatch(/readOnlyHint:\s*true/)
      expect(toolBlock(mcpSrc, 'update_virtual_member')).toMatch(/idempotentHint:\s*true/)
      for (const write of ['create_virtual_member', 'update_virtual_member', 'delete_virtual_member']) {
        expect(toolBlock(mcpSrc, write), `${write} must not claim readOnlyHint`).toMatch(/readOnlyHint:\s*false/)
      }
    })
  })

  describe('REST route surface', () => {
    const expectedRoutes: Array<{ path: string; methods: string[] }> = [
      { path: REST_COLLECTION, methods: ['GET', 'POST'] },
      { path: REST_ITEM, methods: ['PATCH', 'DELETE'] },
    ]

    it.each(expectedRoutes)('has route file + methods: $path', ({ path: routePath, methods }) => {
      const full = path.join(REST_ROOT, routePath)
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      for (const m of methods) {
        expect(restSrc[routePath], `${routePath} missing export ${m}`).toMatch(new RegExp(`export const ${m}\\b`))
      }
    })

    // The MCP tools declare realmId as z.string().uuid(). Unvalidated, a
    // malformed path segment reached Postgres and came back as a 22P02 cast
    // error — a 500 where the tool surface answers with a validation error.
    it('validates the realm id as a uuid before it reaches the query layer', () => {
      for (const [file, src] of Object.entries(restSrc)) {
        expect(src, `${file} missing uuid validation`).toMatch(/z\.string\(\)\.uuid\(\)/)
        expect(src, `${file} must 400 a malformed realm id`)
          .toMatch(/safeParse\(realmId\)\.success\) return jsonError\('Invalid realm id', 400\)/)
      }
      expect(mcpSrc).toMatch(/realmId:\s*z\.string\(\)\.uuid\(\)/)
    })

    it('rate-limits every verb', () => {
      expect(restSrc[REST_COLLECTION]).toMatch(/withRateLimit\([\s\S]*API_READ_LIMIT/)
      for (const src of Object.values(restSrc)) {
        expect(src).toMatch(/API_WRITE_LIMIT/)
      }
    })
  })

  // One tool per verb, in both directions.
  describe('verb mapping — every MCP tool has a REST verb and vice versa', () => {
    const pairs: Array<{ tool: string; file: string; method: string }> = [
      { tool: 'list_virtual_members',   file: REST_COLLECTION, method: 'GET' },
      { tool: 'create_virtual_member',  file: REST_COLLECTION, method: 'POST' },
      { tool: 'update_virtual_member',  file: REST_ITEM,       method: 'PATCH' },
      { tool: 'delete_virtual_member',  file: REST_ITEM,       method: 'DELETE' },
    ]

    it.each(pairs)('$tool <-> $method $file', ({ tool, file, method }) => {
      expect(() => toolBlock(mcpSrc, tool)).not.toThrow()
      expect(restSrc[file]).toMatch(new RegExp(`export const ${method}\\b`))
    })

    it('leaves no orphan REST verb without a tool', () => {
      const restVerbs = Object.values(restSrc)
        .flatMap((src) => [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]))
      expect(new Set(restVerbs)).toEqual(new Set(['GET', 'POST', 'PATCH', 'DELETE']))
      expect(extractToolNames(mcpSrc)).toHaveLength(restVerbs.length)
    })
  })

  describe('shared validator usage — both surfaces speak the same schema', () => {
    const validators = ['createVirtualMemberSchema', 'updateVirtualMemberSchema']

    it.each(validators)('MCP uses validator: %s', (v) => {
      expect(mcpSrc, `MCP virtual-members.ts missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it.each(validators)('REST surface uses validator: %s', (v) => {
      expect(restSrcConcat, `REST routes missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it.each(validators)('server actions use the same validator: %s', (v) => {
      expect(actionsSrc, `actions missing ${v}`).toMatch(new RegExp(`\\b${v}\\b`))
    })

    it('both surfaces import validators from the shared module', () => {
      expect(mcpSrc).toMatch(/from '@\/lib\/data\/validators'/)
      expect(restSrcConcat).toMatch(/from '@\/lib\/data\/validators'/)
    })
  })

  describe('data-function parity — both surfaces call the same lib/data functions', () => {
    const dataFns = [
      'listVirtualMembers',
      'createVirtualMember',
      'updateVirtualMember',
      'deleteVirtualMember',
    ]

    it.each(dataFns)('MCP imports and uses: %s', (fn) => {
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it.each(dataFns)('REST imports and uses: %s', (fn) => {
      expect(restSrcConcat).toMatch(new RegExp(`\\b${fn}\\b`))
    })

    it('neither surface reimplements the query layer', () => {
      expect(mcpSrc).toMatch(/from '@\/lib\/data\/virtual-members'/)
      expect(restSrcConcat).toMatch(/from '@\/lib\/data\/virtual-members'/)
      // No direct drizzle/db access from an API surface.
      expect(mcpSrc).not.toMatch(/from '@\/lib\/db'/)
      expect(restSrcConcat).not.toMatch(/from '@\/lib\/db'/)
    })
  })

  describe('realm authorization — identical gate on both surfaces', () => {
    it('every MCP tool resolves the caller realm role', () => {
      for (const block of mcpSrc.split(/server\.tool\(/).slice(1)) {
        const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
        expect(block, `MCP tool ${name} missing realm role check`)
          .toMatch(/requireRealm(Member|Editor)\(/)
      }
      // Both helpers must go through the single source of truth.
      expect(mcpSrc).toMatch(/getGroupRole\(/)
      expect(mcpSrc).toMatch(/from '@\/lib\/data\/workspaces'/)
    })

    it('every REST route resolves the caller realm role', () => {
      for (const [file, src] of Object.entries(restSrc)) {
        expect(src, `${file} missing getGroupRole`).toMatch(/getGroupRole\(/)
        expect(src, `${file} missing authentication`).toMatch(/authenticateRequest\(/)
      }
    })

    it('reads require membership; writes require a non-viewer role — on both sides', () => {
      // MCP
      expect(toolBlock(mcpSrc, 'list_virtual_members')).toMatch(/requireRealmMember\(/)
      for (const write of ['create_virtual_member', 'update_virtual_member', 'delete_virtual_member']) {
        expect(toolBlock(mcpSrc, write), `${write} must require realm editor`).toMatch(/requireRealmEditor\(/)
      }
      expect(mcpSrc).toMatch(/role !== 'viewer'/)

      // REST — GET accepts any role, writes reject viewers.
      expect(restSrc[REST_COLLECTION]).toMatch(/if \(!role\) return jsonError\('Not a member of this realm', 403\)/)
      const viewerGate = /if \(!role \|\| role === 'viewer'\) return jsonError\('Insufficient permissions', 403\)/g
      expect(restSrc[REST_COLLECTION].match(viewerGate) ?? []).toHaveLength(1) // POST
      expect(restSrc[REST_ITEM].match(viewerGate) ?? []).toHaveLength(2)       // PATCH + DELETE
    })

    it('a miss is a 404 on both surfaces, never a silent success', () => {
      expect(toolBlock(mcpSrc, 'update_virtual_member')).toMatch(/notFound\('Virtual member'\)/)
      expect(toolBlock(mcpSrc, 'delete_virtual_member')).toMatch(/notFound\('Virtual member'\)/)
      expect(restSrc[REST_ITEM].match(/jsonError\('Virtual member not found', 404\)/g) ?? []).toHaveLength(2)
    })
  })

  // ── The intended asymmetry ────────────────────────────────────────────────
  // REST/MCP are realm-addressed: the caller names the realm and the realm role
  // is the whole gate. The board server action is project-addressed: the caller
  // only ever proves access to a PROJECT, so it must additionally prove the
  // member is reachable from that project before it can act on it — otherwise a
  // project editor could rename or delete members of realms they cannot see.
  describe('server action gate — deliberately STRICTER than REST/MCP', () => {
    it('project-scoped writes prove project editorship first', () => {
      expect(actionsSrc).toMatch(/export async function createVirtualMemberAction[\s\S]*?requireEditor\(projectId\)/)
      expect(actionsSrc).toMatch(/export async function updateVirtualMemberAction[\s\S]*?requireEditor\(projectId\)/)
      expect(actionsSrc).toMatch(/export async function deleteVirtualMemberAction[\s\S]*?requireEditor\(projectId\)/)
    })

    it('update and delete additionally prove the member is reachable from this project', () => {
      const update = actionsSrc.slice(actionsSrc.indexOf('export async function updateVirtualMemberAction'))
      const del = actionsSrc.slice(actionsSrc.indexOf('export async function deleteVirtualMemberAction'))
      expect(update).toMatch(/_isVirtualMemberAssignable\(virtualMemberId, projectId\)/)
      expect(del).toMatch(/_isVirtualMemberAssignable\(virtualMemberId, projectId\)/)
    })

    it('delete ALSO demands realm-editor rights — the extra hop REST/MCP get for free', () => {
      const del = actionsSrc.slice(actionsSrc.indexOf('export async function deleteVirtualMemberAction'))
      expect(del).toMatch(/getGroupRole\(member\.realmId, userId\)/)
      expect(del).toMatch(/!role \|\| role === 'viewer'/)
    })

    // A rename/recolor rewrites a SHARED identity visible on every project in
    // the realm, exactly like delete does — so it carries the same realm gate.
    // Project-editor rights alone used to be enough here, which was strictly
    // more permissive than the REST PATCH and the MCP tool.
    it('update demands realm-editor rights too, matching REST PATCH / MCP', () => {
      const update = actionsSrc.slice(
        actionsSrc.indexOf('export async function updateVirtualMemberAction'),
        actionsSrc.indexOf('export async function deleteVirtualMemberAction'),
      )
      expect(update).toMatch(/getGroupRole\(member\.realmId, userId\)/)
      expect(update).toMatch(/!role \|\| role === 'viewer'/)
    })

    it('REST/MCP delete does NOT carry the project-reachability check — realm rights are the contract there', () => {
      expect(toolBlock(mcpSrc, 'delete_virtual_member')).not.toMatch(/isVirtualMemberAssignable/)
      expect(restSrc[REST_ITEM]).not.toMatch(/isVirtualMemberAssignable/)
      // ...and neither reads a projectId at all: there is no project in scope.
      expect(restSrc[REST_ITEM]).not.toMatch(/projectId/)
    })

    it('the realm is resolved server-side in the action, never taken from the client', () => {
      // A client-supplied realmId would defeat the whole project-scoped gate.
      expect(actionsSrc).toMatch(/_findRealmIdsForProject\(projectId\)/)
      expect(actionsSrc).not.toMatch(/realmId:\s*string/)
    })
  })
})
