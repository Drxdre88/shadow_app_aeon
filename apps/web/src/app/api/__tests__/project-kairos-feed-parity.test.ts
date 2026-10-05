/**
 * "Watched by Kairos" (projects.settings.kairosFeed) MCP <-> REST <-> action parity.
 *
 * Three doors set the same switch: the Connect Kairos modal (server action),
 * the MCP tool `set_project_kairos_feed`, and REST `PUT /api/v1/projects/[id]/kairos-feed`.
 * All three must validate with the one shared schema and write through the one
 * merging data helper, so no surface can wipe the rest of a board's settings.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/projects.ts')
const REST_ROUTE = path.join(WEB_ROOT, 'src/app/api/v1/projects/[id]/kairos-feed/route.ts')
const ACTIONS_FILE = path.join(WEB_ROOT, 'src/lib/actions/projects.ts')
const MCP_DOCS = path.join(WEB_ROOT, 'src/components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolBlock(src: string, name: string): string {
  const block = src.split(/server\.tool\(/).slice(1).find((b) => b.trimStart().startsWith(`'${name}'`))
  if (!block) throw new Error(`MCP tool not found: ${name}`)
  return block
}

describe('Kairos feed MCP <-> REST parity', () => {
  const mcp = toolBlock(read(MCP_TOOL_FILE), 'set_project_kairos_feed')

  it('has a REST twin with PUT, uuid validation and a write rate limit', () => {
    expect(existsSync(REST_ROUTE)).toBe(true)
    const rest = read(REST_ROUTE)
    expect(rest).toMatch(/export const PUT\b/)
    expect(rest).toMatch(/z\.string\(\)\.uuid\(\)/)
    expect(rest).toMatch(/API_WRITE_LIMIT/)
  })

  it('validates with the one shared schema on every surface', () => {
    expect(mcp).toMatch(/setProjectKairosFeedSchema\.shape\.feed/)
    expect(read(REST_ROUTE)).toMatch(/setProjectKairosFeedSchema\.safeParse\(body\)/)
    expect(read(ACTIONS_FILE)).toMatch(/setProjectKairosFeedSchema\.parse\(/)
  })

  it('writes through the merging data helper on every surface', () => {
    expect(mcp).toMatch(/setProjectKairosFeed\(projectId, feed\)/)
    expect(read(REST_ROUTE)).toMatch(/setProjectKairosFeed\(id, parsed\.data\.feed\)/)
    expect(read(ACTIONS_FILE)).toMatch(/_setProjectKairosFeed\(projectId, parsed\.feed\)/)
  })

  it('allows only the project owner on every surface', () => {
    expect(mcp).toMatch(/verifyProjectAccess\(projectId, uid\)[\s\S]*?access\.role !== 'owner'/)
    expect(read(REST_ROUTE)).toMatch(/verifyProjectAccess\(id, result\.id\)[\s\S]*?access\.role !== 'owner'/)
    expect(read(ACTIONS_FILE)).toMatch(/export async function setProjectKairosFeed[\s\S]*?await requireOwner\(projectId\)/)
  })

  it('is annotated as an idempotent, non-destructive write and documented', () => {
    expect(mcp).toMatch(/readOnlyHint:\s*false/)
    expect(mcp).toMatch(/destructiveHint:\s*false/)
    expect(mcp).toMatch(/idempotentHint:\s*true/)
    expect(read(MCP_DOCS)).toContain("'set_project_kairos_feed'")
  })
})
