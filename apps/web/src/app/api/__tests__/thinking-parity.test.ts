/**
 * Thinking queue MCP <-> REST parity test (docs/kairos/32 §3).
 *
 * Mirrors memories-parity.test.ts. The Claude Max routine drives the queue
 * over MCP; scripts and dashboards use REST. Statically verifies:
 *   - exactly the three expected MCP tools are registered
 *   - every MCP capability has a matching REST route file + method
 *   - both surfaces import the same validators from `@/lib/data/validators/thinking`
 *   - both surfaces call the same queue functions from `@/lib/kairos/thinking/queue`
 *   - every tool/route binds to the calling user (getUserId / authenticateRequest)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const WEB_ROOT = path.resolve(__dirname, '../../../..')
const MCP_TOOL_FILE = path.join(WEB_ROOT, 'src/app/api/[transport]/tools/thinking.ts')
const REST_ROOT = path.join(WEB_ROOT, 'src/app/api/v1/kairos/thinking-jobs')

const ROUTES: Array<{ path: string; methods: string[]; tool: string; validator: string; fn: string }> = [
  { path: 'route.ts', methods: ['GET'], tool: 'list_thinking_jobs', validator: 'listThinkingJobsSchema', fn: 'listThinkingJobs' },
  { path: 'claim/route.ts', methods: ['POST'], tool: 'claim_thinking_job', validator: 'claimThinkingJobSchema', fn: 'claimThinkingJob' },
  { path: '[id]/submit/route.ts', methods: ['POST'], tool: 'submit_thinking_job', validator: 'submitThinkingJobSchema', fn: 'submitThinkingJob' },
]

const read = (p: string) => readFileSync(p, 'utf8')

function extractToolNames(src: string): string[] {
  const re = /server\.tool\(\s*['"]([a-z_]+)['"]/g
  const names: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) names.push(m[1])
  return names
}

describe('Thinking queue MCP <-> REST parity', () => {
  const mcpSrc = read(MCP_TOOL_FILE)

  it('exposes exactly the three thinking-queue tools', () => {
    expect(new Set(extractToolNames(mcpSrc))).toEqual(new Set(ROUTES.map((r) => r.tool)))
  })

  it('MCP tools import validators and queue functions from the shared modules', () => {
    expect(mcpSrc).toMatch(/from '@\/lib\/data\/validators\/thinking'/)
    expect(mcpSrc).toMatch(/from '@\/lib\/kairos\/thinking\/queue'/)
  })

  describe.each(ROUTES)('$tool <-> $path', ({ path: routePath, methods, validator, fn }) => {
    const full = path.join(REST_ROOT, routePath)

    it('route file exists with the expected methods', () => {
      expect(existsSync(full), `missing REST route file: ${routePath}`).toBe(true)
      const src = read(full)
      for (const m of methods) expect(src).toMatch(new RegExp(`export const ${m}\\b`))
    })

    it('both surfaces use the same validator and queue function', () => {
      const src = read(full)
      expect(src).toMatch(new RegExp(`\\b${validator}\\b`))
      expect(mcpSrc).toMatch(new RegExp(`\\b${validator}\\b`))
      expect(src).toMatch(new RegExp(`\\b${fn}\\b`))
      expect(mcpSrc).toMatch(new RegExp(`\\b${fn}\\b`))
      expect(src).toMatch(/from '@\/lib\/data\/validators\/thinking'/)
      expect(src).toMatch(/from '@\/lib\/kairos\/thinking\/queue'/)
    })

    it('route authenticates and narrows with isApiUser before using result.id', () => {
      const src = read(full)
      expect(src).toMatch(/authenticateRequest\(/)
      expect(src).toMatch(/isApiUser\(result\)/)
      expect(src).toMatch(new RegExp(`${fn}\\(result\\.id`))
    })
  })

  it('every MCP tool binds to the calling user via getUserId(extra)', () => {
    for (const block of mcpSrc.split(/server\.tool\(/).slice(1)) {
      const name = block.match(/['"]([a-z_]+)['"]/)?.[1] ?? '<unknown>'
      expect(block, `MCP tool ${name} missing getUserId(extra)`).toMatch(/getUserId\(extra\)/)
      expect(block, `MCP tool ${name} must pass uid to the queue`).toMatch(/Thinking(Job|Jobs)\(uid/)
    }
  })

  it('the claim route declares a 300s limit (claim plans lazily, incl. weekly concept clustering)', () => {
    expect(read(path.join(REST_ROOT, 'claim/route.ts'))).toMatch(/export const maxDuration = 300\b/)
  })
})
