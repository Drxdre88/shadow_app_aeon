// Typed telemetry out of an engine's stream output. The runner used to blind-
// batch stdout into kind:'message' text events; this module parses each
// stream-json line into typed events (tool_use / tool_result / thinking /
// message / usage / system) so the Flight Deck can render a mission timeline
// instead of raw JSON soup.
//
// Shape verified live against claude CLI v2.1.x on 2026-08-21 (fixture capture
// in stream-parser.test.ts). Unrecognized lines are handed back as raw text —
// parse best-effort, degrade to the old behaviour, never throw.

import { tryParse } from './envelope.js'

export interface TypedEvent {
  kind: 'tool_use' | 'tool_result' | 'thinking' | 'message' | 'usage' | 'system'
  toolName?: string | null
  payload: Record<string, unknown>
}

export interface MissionStats {
  totalCostUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  thinkingTokens?: number
  numTurns?: number
  durationMs?: number
  durationApiMs?: number
  toolCalls: number
  model?: string
}

export interface StreamParser {
  // Feed a raw stdout chunk. Returns typed events for every complete parsed
  // line, plus any unparseable text via `raw` (the caller falls back to the
  // legacy message-batch path for it).
  feed(chunk: string): { events: TypedEvent[]; raw: string }
  // Drain buffered state at stream end (partial last line, pending usage).
  flush(): { events: TypedEvent[]; raw: string }
  stats(): MissionStats
}

const TEXT_CAP = 4000
const INPUT_CAP = 2000
const RESULT_CAP = 600
// Postgres jsonb refuses \u0000 escapes, and the events route stores payloads
// as jsonb — one NUL in a Bash result would 500 the whole batch away.
// eslint-disable-next-line no-control-regex
const JSONB_UNSAFE = /\u0000/g

// Raw text posted outside the parser (legacy batching, stderr, engines with
// no streamParser) needs the same jsonb safety: NUL stripped, and no chunk
// boundary splitting a surrogate pair.
export function jsonbSafeChunks(text: string, limit: number): string[] {
  const clean = text.replace(JSONB_UNSAFE, '')
  const chunks: string[] = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + limit, clean.length)
    const last = clean.charCodeAt(end - 1)
    if (end < clean.length && last >= 0xd800 && last <= 0xdbff) end++
    chunks.push(clean.slice(i, end))
    i = end
  }
  return chunks
}

function cap(text: string, limit: number): string {
  let out = text.replace(JSONB_UNSAFE, '')
  if (out.length > limit) {
    out = out.slice(0, limit)
    // A cut can land between the halves of a surrogate pair; a lone high half
    // serializes to an unpaired escape jsonb also refuses.
    const last = out.charCodeAt(out.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
    out += '…'
  }
  return out
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

// One JSON-stringified summary of a tool input, capped. The full input can be
// megabytes (Write file contents); the timeline needs the gist, the raw stays
// out of the DB by design (Archon's two-tier policy).
function summarizeInput(input: unknown): string {
  if (input === null || input === undefined) return ''
  try {
    return cap(JSON.stringify(input), INPUT_CAP)
  } catch {
    return ''
  }
}

// tool_result content is a string or an array of {type:'text', text} blocks.
function summarizeResultContent(content: unknown): string {
  if (typeof content === 'string') return cap(content, RESULT_CAP)
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
        parts.push((block as { text: string }).text)
      }
    }
    return cap(parts.join('\n'), RESULT_CAP)
  }
  return ''
}

interface Usage {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
}

interface ClaudeLine {
  type?: unknown
  subtype?: unknown
  request_id?: unknown
  parent_tool_use_id?: unknown
  message?: { content?: unknown; usage?: Usage }
  [key: string]: unknown
}

// ── claude stream-json ───────────────────────────────────────────────────

interface ClaudeCtx {
  // tool_use_id → tool name, so tool_result events carry the tool they answer.
  toolNames: Map<string, string>
  // Every assistant line repeats its API request's usage snapshot; emit one
  // usage event per request (last snapshot wins) instead of one per line.
  pendingUsageKey: string | null
  pendingUsage: Record<string, unknown> | null
  stats: MissionStats
}

function usagePayload(usage: Usage, requestId: string, parentToolUseId: unknown): Record<string, unknown> {
  return {
    requestId,
    ...(typeof parentToolUseId === 'string' ? { parentToolUseId } : {}),
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cacheCreationTokens: num(usage.cache_creation_input_tokens) ?? 0,
  }
}

function flushPendingUsage(ctx: ClaudeCtx): TypedEvent[] {
  if (!ctx.pendingUsage) return []
  const event: TypedEvent = { kind: 'usage', payload: ctx.pendingUsage }
  ctx.pendingUsage = null
  ctx.pendingUsageKey = null
  return [event]
}

function trackUsage(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  const usage = line.message?.usage
  const requestId = typeof line.request_id === 'string' ? line.request_id : null
  if (!usage || !requestId) return []
  const flushed = ctx.pendingUsageKey !== null && ctx.pendingUsageKey !== requestId
    ? flushPendingUsage(ctx)
    : []
  ctx.pendingUsageKey = requestId
  ctx.pendingUsage = usagePayload(usage, requestId, line.parent_tool_use_id)
  return flushed
}

function mapAssistantLine(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  const events = trackUsage(ctx, line)
  const parent = typeof line.parent_tool_use_id === 'string'
    ? { parentToolUseId: line.parent_tool_use_id }
    : {}
  const content = line.message?.content
  if (!Array.isArray(content)) return events

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      events.push({ kind: 'thinking', payload: { text: cap(b.thinking, TEXT_CAP), ...parent } })
    } else if (b.type === 'text' && typeof b.text === 'string') {
      events.push({ kind: 'message', payload: { stream: 'assistant', text: cap(b.text, TEXT_CAP), ...parent } })
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      const toolUseId = typeof b.id === 'string' ? b.id : null
      // The server's toolName column caps at 80; a long MCP tool name must
      // not 400 the events beside it.
      const name = b.name.slice(0, 80)
      if (toolUseId) ctx.toolNames.set(toolUseId, name)
      ctx.stats.toolCalls++
      events.push({
        kind: 'tool_use',
        toolName: name,
        payload: { toolUseId, input: summarizeInput(b.input), ...parent },
      })
    }
  }
  return events
}

function mapUserLine(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  const content = line.message?.content
  if (!Array.isArray(content)) return []
  const parent = typeof line.parent_tool_use_id === 'string'
    ? { parentToolUseId: line.parent_tool_use_id }
    : {}

  const events: TypedEvent[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type !== 'tool_result') continue
    const toolUseId = typeof b.tool_use_id === 'string' ? b.tool_use_id : null
    const toolName = toolUseId ? ctx.toolNames.get(toolUseId) ?? null : null
    // The pair is resolved — drop the entry so the map doesn't grow for the
    // mission's lifetime.
    if (toolUseId) ctx.toolNames.delete(toolUseId)
    events.push({
      kind: 'tool_result',
      toolName,
      payload: {
        toolUseId,
        isError: b.is_error === true,
        content: summarizeResultContent(b.content),
        ...parent,
      },
    })
  }
  return events
}

function mapSystemLine(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  if (line.subtype === 'init') {
    if (typeof line.model === 'string') ctx.stats.model = line.model
    const tools = Array.isArray(line.tools) ? line.tools.length : undefined
    return [{
      kind: 'system',
      payload: {
        subtype: 'init',
        model: typeof line.model === 'string' ? line.model : null,
        permissionMode: typeof line.permissionMode === 'string' ? line.permissionMode : null,
        version: typeof line.claude_code_version === 'string' ? line.claude_code_version : null,
        ...(tools !== undefined ? { toolCount: tools } : {}),
      },
    }]
  }
  // Hook lifecycle floods the stream (5+ hooks × started/progress/response);
  // only a failing hook earns a timeline slot.
  if (line.subtype === 'hook_response' && num(line.exit_code) !== undefined && line.exit_code !== 0) {
    return [{
      kind: 'system',
      payload: {
        subtype: 'hook_failed',
        hookName: typeof line.hook_name === 'string' ? line.hook_name : null,
        exitCode: line.exit_code,
      },
    }]
  }
  // thinking_tokens / hook_started / hook_progress / everything else: noise.
  return []
}

function mapResultLine(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  const usage = (line.usage ?? {}) as Usage & { output_tokens_details?: { thinking_tokens?: unknown } }
  ctx.stats.totalCostUsd = num(line.total_cost_usd) ?? ctx.stats.totalCostUsd
  ctx.stats.inputTokens = num(usage.input_tokens) ?? ctx.stats.inputTokens
  ctx.stats.outputTokens = num(usage.output_tokens) ?? ctx.stats.outputTokens
  ctx.stats.cacheReadTokens = num(usage.cache_read_input_tokens) ?? ctx.stats.cacheReadTokens
  ctx.stats.cacheCreationTokens = num(usage.cache_creation_input_tokens) ?? ctx.stats.cacheCreationTokens
  ctx.stats.thinkingTokens = num(usage.output_tokens_details?.thinking_tokens) ?? ctx.stats.thinkingTokens
  ctx.stats.numTurns = num(line.num_turns) ?? ctx.stats.numTurns
  ctx.stats.durationMs = num(line.duration_ms) ?? ctx.stats.durationMs
  ctx.stats.durationApiMs = num(line.duration_api_ms) ?? ctx.stats.durationApiMs
  // The stop/result events posted at finalize carry the verdict; the stats
  // land on the session row and the envelope — no separate timeline event.
  return flushPendingUsage(ctx)
}

// Pure per-line mapper. Returns null when the line is not recognizable
// stream-json — the caller keeps it as raw text.
function mapClaudeLine(ctx: ClaudeCtx, rawLine: string): TypedEvent[] | null {
  const trimmed = rawLine.trim()
  if (!trimmed.startsWith('{')) return null
  const line = tryParse(trimmed) as ClaudeLine | null
  if (!line || typeof line.type !== 'string') return null

  switch (line.type) {
    case 'assistant': return mapAssistantLine(ctx, line)
    case 'user': return mapUserLine(ctx, line)
    case 'system': return mapSystemLine(ctx, line)
    case 'result': return mapResultLine(ctx, line)
    // Known noise: consumed, no event.
    case 'rate_limit_event': return []
    default: return []
  }
}

export function createClaudeStreamParser(): StreamParser {
  const ctx: ClaudeCtx = {
    toolNames: new Map(),
    pendingUsageKey: null,
    pendingUsage: null,
    stats: { toolCalls: 0 },
  }
  let tail = ''

  return {
    feed(chunk: string) {
      const events: TypedEvent[] = []
      let raw = ''
      tail += chunk
      const lines = tail.split(/\r?\n/)
      tail = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const mapped = mapClaudeLine(ctx, line)
        if (mapped === null) raw += `${line}\n`
        else events.push(...mapped)
      }
      return { events, raw }
    },
    flush() {
      const events: TypedEvent[] = []
      let raw = ''
      if (tail.trim()) {
        const mapped = mapClaudeLine(ctx, tail)
        if (mapped === null) raw = tail
        else events.push(...mapped)
        tail = ''
      }
      events.push(...flushPendingUsage(ctx))
      return { events, raw }
    },
    stats: () => ctx.stats,
  }
}
