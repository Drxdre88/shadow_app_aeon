/**
 * Entity map MCP <-> REST parity (Total Recall step 2a).
 *   - list_entities <-> GET /api/v1/kairos/entities
 *   - get_entity    <-> GET /api/v1/kairos/entities/[id]
 * Both surfaces share lib/data/validators/entities.ts and the read fns in
 * lib/data/entities/queries.ts. Read-only, owner-only (Vorath).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { importStatements } from './import-statements'

const SRC = path.resolve(__dirname, '../../..')
const MCP_TOOL_FILE = path.join(SRC, 'app/api/[transport]/tools/entities.ts')
const MCP_ROUTE = path.join(SRC, 'app/api/[transport]/route.ts')
const MCP_INDEX = path.join(SRC, 'app/api/[transport]/tools/index.ts')
const LIST_ROUTE = path.join(SRC, 'app/api/v1/kairos/entities/route.ts')
const GET_ROUTE = path.join(SRC, 'app/api/v1/kairos/entities/[id]/route.ts')

const read = (p: string) => readFileSync(p, 'utf8')
const toolNames = (src: string) => [...src.matchAll(/server\.tool\(\s*['"]([a-z_]+)['"]/g)].map((m) => m[1])

describe('Entity map MCP <-> REST parity', () => {
  const mcp = read(MCP_TOOL_FILE)
  const list = existsSync(LIST_ROUTE) ? read(LIST_ROUTE) : ''
  const get = existsSync(GET_ROUTE) ? read(GET_ROUTE) : ''

  it('exposes exactly list_entities and get_entity, both read-only', () => {
    expect(toolNames(mcp)).toEqual(['list_entities', 'get_entity'])
    expect(mcp).toMatch(/title: 'List Entities', readOnlyHint: true/)
    expect(mcp).toMatch(/title: 'Get Entity', readOnlyHint: true/)
  })

  it('has GET-only REST twins', () => {
    for (const src of [list, get]) {
      expect(src).toMatch(/export const GET\b/)
      expect(src).not.toMatch(/export const (POST|PUT|PATCH|DELETE)\b/)
    }
  })

  it('shares the validators and the data fns', () => {
    expect(mcp).toContain("from '@/lib/data/validators/entities'")
    expect(mcp).toMatch(/listEntitiesSchema\.safeParse\(/)
    expect(mcp).toMatch(/getEntitySchema\.safeParse\(/)
    expect(list).toMatch(/listEntitiesSchema\.safeParse\(/)
    expect(get).toMatch(/getEntitySchema\.safeParse\(/)
    expect(mcp).toMatch(/listEntities\(uid, parsed\.data\)/)
    expect(mcp).toMatch(/getEntity\(uid, parsed\.data\)/)
    expect(list).toMatch(/listEntities\(result\.id, parsed\.data\)/)
    expect(get).toMatch(/getEntity\(result\.id, parsed\.data\)/)
  })

  it('imports no writer on any surface', () => {
    for (const src of [mcp, list, get]) {
      for (const stmt of importStatements(src)) expect(stmt).not.toMatch(/\b(seed|rescan|scan|insert|update|delete)\w*/i)
    }
  })

  it('REST routes are owner-only through vorathGuard', () => {
    for (const src of [list, get]) {
      expect(src).toMatch(/authenticateRequest\(/)
      expect(src).toMatch(/vorathGuard\(result\)/)
    }
  })

  it('is registered on the MCP server under the vorath profile only', () => {
    expect(read(MCP_INDEX)).toMatch(/registerEntityTools/)
    expect(read(MCP_ROUTE)).toMatch(/\[registerEntityTools, \['vorath'\]\]/)
  })
})
