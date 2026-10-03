import { createHash } from 'node:crypto'
import { after } from 'next/server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { TodayClientKind } from '@/lib/data/validators/kairos-today'
import { noteMcpUse, type TodayClient } from './today'

// ─────────────────────────────────────────────────────────────────────────
// "Claude used him over MCP" (spec_one_mind). installTodayUseTracking wraps
// server.tool BEFORE the register* calls so the listed tools note one
// coalesced 'used' entry per client+tool+15-min bucket. The handler result is
// returned untouched first; the note runs in after() (detached fallback) —
// no synchronous DB work is added to any MCP call. Kairos's own routine
// (thinking jobs), dialogue tools, answer/accept/voice (their domain writes
// record) and board/gantt/realm tools are deliberately NOT listed.
// ─────────────────────────────────────────────────────────────────────────

export const TODAY_USE_TOOLS: ReadonlySet<string> = new Set([
  'search_memories', 'prepare_context', 'get_memory_with_neighbours', 'get_belief_trail', 'create_memory',
  'update_memory', 'link_memory', 'kairos_reflect', 'list_beliefs', 'get_mind_comparison', 'get_constitution',
  'propose_constitution_amendment', 'list_dominions', 'get_dominion', 'inspect_dominion', 'list_objectives',
  'get_pending_kairos_ask', 'list_open_kairos_asks', 'run_kairos_ask', 'get_trace_history',
  'prepare_aether_context', 'commit_aether', 'list_memory_ops', 'revert_memory_op', 'list_kairos_promises',
])

export function tokenKindOf(token: string): TodayClientKind {
  if (token.startsWith('aeon_at_')) return 'oauth'
  if (token.startsWith('aeon_k1_')) return 'api_key'
  if (token.startsWith('aeon_s1_')) return 'mobile'
  return 'master'
}

export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8)
}

const CLIENT_KINDS: ReadonlySet<string> = new Set(['oauth', 'api_key', 'mobile', 'master'])

export function todayClientFromExtra(extra: unknown): { userId: string; client: TodayClient } | null {
  const info = (extra as { authInfo?: { extra?: Record<string, unknown> } } | null | undefined)?.authInfo?.extra
  const userId = info?.userId
  const kind = info?.tokenKind
  const fp = info?.fp
  if (typeof userId !== 'string' || !userId) return null
  if (typeof kind !== 'string' || !CLIENT_KINDS.has(kind)) return null
  if (typeof fp !== 'string' || !/^[0-9a-f]{8}$/.test(fp)) return null
  return { userId, client: { kind: kind as TodayClientKind, fp } }
}

function isErrorResult(result: unknown): boolean {
  return Boolean(result && typeof result === 'object' && (result as { isError?: unknown }).isError === true)
}

function schedule(task: () => Promise<void>): void {
  const run = () => Promise.resolve().then(task).catch(() => undefined)
  try {
    after(run)
  } catch {
    void run()
  }
}

type ToolCallback = (...args: unknown[]) => unknown

export function wrapToolForTodayUse(name: string, cb: ToolCallback): ToolCallback {
  return async (...cbArgs: unknown[]) => {
    const result = await cb(...cbArgs)
    const ctx = todayClientFromExtra(cbArgs[cbArgs.length - 1])
    if (ctx && !isErrorResult(result)) {
      const toolArgs = cbArgs.length > 1 ? cbArgs[0] : undefined
      schedule(() => noteMcpUse(ctx.userId, name, toolArgs, ctx.client))
    }
    return result
  }
}

export function installTodayUseTracking(server: McpServer): void {
  const original = server.tool.bind(server) as (...args: unknown[]) => unknown
  const tool = (...args: unknown[]) => {
    const name = args[0]
    const last = args.length - 1
    const cb = args[last]
    if (typeof name === 'string' && TODAY_USE_TOOLS.has(name) && typeof cb === 'function') {
      args[last] = wrapToolForTodayUse(name, cb as ToolCallback)
    }
    return original(...args)
  }
  Object.assign(server, { tool })
}
