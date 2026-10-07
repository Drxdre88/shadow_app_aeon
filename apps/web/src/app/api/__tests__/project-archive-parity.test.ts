/**
 * Board Archive switch: the list surfaces leave archived boards out by
 * default on both MCP and REST, with the same opt-in, through the one data
 * helper. The switch itself is creator-only and lives in the server action.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/projects.ts')
const REST_LIST = path.join(WEB_ROOT, 'src/app/api/v1/projects/route.ts')
const ACTIONS_FILE = path.join(WEB_ROOT, 'src/lib/actions/project-archive.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolBlock(src: string, name: string): string {
  const block = src.split(/server\.tool\(/).slice(1).find((b) => b.trimStart().startsWith(`'${name}'`))
  if (!block) throw new Error(`MCP tool not found: ${name}`)
  return block
}

describe('archived boards in project lists — MCP <-> REST parity', () => {
  const mcp = toolBlock(read(MCP_TOOL_FILE), 'list_projects')

  it('both surfaces opt in to archived boards through findProjects', () => {
    expect(mcp).toMatch(/listProjectsSchema\.shape\.includeArchived/)
    expect(mcp).toMatch(/findProjects\([\s\S]*?\{ includeArchived \}\)/)
    const rest = read(REST_LIST)
    expect(rest).toMatch(/searchParams\.get\('archived'\) === 'true'/)
    expect(rest).toMatch(/findProjects\([\s\S]*?\{ includeArchived \}\)/)
  })

  it('realm board lists (MCP list_realm_projects, REST realm projects, realm settings) hide archived boards', () => {
    const src = read(path.join(WEB_ROOT, 'src/lib/data/workspaces.ts'))
    expect(src).toMatch(/export async function findProjectsInGroup[\s\S]*?\.where\(and\(eq\(projectGroups\.groupId, groupId\), notArchivedSql\)\)/)
  })

  it('archiving is creator-only and validated with the shared schema', () => {
    const actions = read(ACTIONS_FILE)
    expect(actions).toMatch(/export async function setProjectArchived[\s\S]*?await requireOwner\(projectId\)/)
    expect(actions).toMatch(/setProjectArchivedSchema\.parse\(/)
    expect(actions).toMatch(/_setProjectArchivedForOwner\(projectId, userId, parsed\.archived\)/)
  })
})
