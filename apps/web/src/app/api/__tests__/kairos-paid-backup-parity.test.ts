/**
 * Kairos "Paid backup" switch: server action <-> MCP <-> REST parity.
 *
 * Three doors read/write the same per-user switch: the Connect Kairos status
 * view (server action), the MCP tools get_/set_kairos_paid_backup, and REST
 * GET/PUT /api/v1/kairos/paid-backup. All must validate with the one shared
 * schema and go through the one data helper pair (which merges the key into
 * user_preferences rather than replacing the blob).
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/paid-backup.ts')
const MCP_ROUTE = path.join(WEB_ROOT, 'src/app/api/[transport]/route.ts')
const REST_ROUTE = path.join(WEB_ROOT, 'src/app/api/v1/kairos/paid-backup/route.ts')
const ACTIONS_FILE = path.join(WEB_ROOT, 'src/lib/actions/kairos-brain.ts')
const MCP_DOCS = path.join(WEB_ROOT, 'src/components/ui/help/mcpToolCatalog.ts')

const read = (p: string) => readFileSync(p, 'utf8')

function toolBlock(src: string, name: string): string {
  const block = src.split(/server\.tool\(/).slice(1).find((b) => b.trimStart().startsWith(`'${name}'`))
  if (!block) throw new Error(`MCP tool not found: ${name}`)
  return block
}

describe('Kairos paid backup MCP <-> REST <-> action parity', () => {
  const tools = read(MCP_TOOL_FILE)
  const getTool = toolBlock(tools, 'get_kairos_paid_backup')
  const setTool = toolBlock(tools, 'set_kairos_paid_backup')

  it('is registered on the MCP server and documented', () => {
    expect(read(MCP_ROUTE)).toMatch(/\[registerPaidBackupTools, \[/)
    expect(read(MCP_DOCS)).toContain("'get_kairos_paid_backup'")
    expect(read(MCP_DOCS)).toContain("'set_kairos_paid_backup'")
  })

  it('has a REST twin: GET (read limit) and PUT (write limit)', () => {
    expect(existsSync(REST_ROUTE)).toBe(true)
    const rest = read(REST_ROUTE)
    expect(rest).toMatch(/export const GET\b/)
    expect(rest).toMatch(/export const PUT\b/)
    expect(rest).toMatch(/API_READ_LIMIT/)
    expect(rest).toMatch(/API_WRITE_LIMIT/)
  })

  it('validates writes with the one shared schema on every surface', () => {
    expect(setTool).toMatch(/setKairosPaidBackupSchema\.safeParse\(args\)/)
    expect(read(REST_ROUTE)).toMatch(/setKairosPaidBackupSchema\.safeParse\(body\)/)
    expect(read(ACTIONS_FILE)).toMatch(/setKairosPaidBackupSchema\.parse\(/)
  })

  it('reads and writes through the shared data helpers, scoped to the caller', () => {
    expect(getTool).toMatch(/getPaidBackupSetting\(uid\)/)
    expect(setTool).toMatch(/setPaidBackupSetting\(uid, parsed\.data\.enabled\)/)
    const rest = read(REST_ROUTE)
    expect(rest).toMatch(/getPaidBackupSetting\(result\.id\)/)
    expect(rest).toMatch(/setPaidBackupSetting\(result\.id, parsed\.data\.enabled\)/)
    const actions = read(ACTIONS_FILE)
    expect(actions).toMatch(/getPaidBackupSetting\(userId\)/)
    expect(actions).toMatch(/setPaidBackupSetting\(userId, parsed\.enabled\)/)
    expect(actions).toMatch(/await (requireAuth|requireVorath|safeRequireVorath)\(\)/)
  })

  it('annotates the tools correctly', () => {
    expect(getTool).toMatch(/readOnlyHint:\s*true/)
    expect(setTool).toMatch(/readOnlyHint:\s*false/)
    expect(setTool).toMatch(/destructiveHint:\s*false/)
    expect(setTool).toMatch(/idempotentHint:\s*true/)
  })
})
