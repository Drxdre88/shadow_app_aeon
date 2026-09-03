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
// A lone CR is not a line separator, so a CLI drawing a progress spinner with
// \r never completes a line and the partial-line buffer grows for the whole
// mission (60KB observed). Past this the buffer is handed back as raw text and
// reset: memory bounded, nothing dropped.
const TAIL_CAP = 1_000_000
// tool_use_id → name entries only clear on the matching tool_result, so a
// mission whose results never arrive (killed subagent, truncated stream) would
// grow the map for its lifetime.
const TOOL_NAME_CAP = 500
// Postgres jsonb refuses \u0000 escapes, and the events route stores payloads
// as jsonb — one NUL in a Bash result would 500 the whole batch away.
// eslint-disable-next-line no-control-regex
const JSONB_UNSAFE = /\u0000/g
// jsonb refuses an unpaired surrogate escape too. Model-authored JSON carries
// them through JSON.parse intact, so they have to be replaced, not just cut.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

function jsonbSafeString(text: string): string {
  return text.replace(JSONB_UNSAFE, '').replace(LONE_SURROGATE, '\uFFFD')
}

// ── secret redaction ─────────────────────────────────────────────────────
//
// Tool inputs and results are posted verbatim, so one `gh auth token` or `env`
// inside a mission would print a live credential onto the timeline — and dev
// shares one database with prod. Every runner env value long enough to be a
// credential and sitting under a credential-shaped key is masked on the way out.

const SECRET_KEY = /TOKEN|KEY|SECRET|PASSWORD/i
const MIN_SECRET_LENGTH = 20

let redactions: Array<{ value: string; label: string }> = []

// Exported so a test can install a fake env; the runner builds the list once at
// module load and never rebuilds it.
export function refreshRedactions(env: Record<string, string | undefined> = process.env): void {
  const found: Array<{ value: string; label: string }> = []
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH) continue
    if (!SECRET_KEY.test(key)) continue
    found.push({ value, label: key })
  }
  // Longest first: a value containing a shorter one must be masked whole.
  redactions = found.sort((a, b) => b.value.length - a.value.length)
}

refreshRedactions()

function redact(text: string): string {
  let out = text
  for (const { value, label } of redactions) {
    if (out.includes(value)) out = out.split(value).join(`[redacted:${label}]`)
  }
  return out
}

// Raw text posted outside the parser (legacy batching, stderr, engines with
// no streamParser) needs the same jsonb safety: NUL stripped, and no chunk
// boundary splitting a surrogate pair.
export function jsonbSafeChunks(text: string, limit: number): string[] {
  const clean = redact(text).replace(JSONB_UNSAFE, '')
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

// Deep jsonb guard for a whole parsed structure. The terminal result envelope
// is the one payload written to jsonb without passing through cap(): a NUL
// inside the model's fenced JSON survives JSON.parse and Postgres rejects the
// write as a non-retriable 400, leaving the mission with no result on the card.
const SANITIZE_MAX_DEPTH = 12

export function sanitizeJsonbDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return jsonbSafeString(value)
  if (value === null || typeof value !== 'object') return value
  if (depth >= SANITIZE_MAX_DEPTH) return '[depth capped]'
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonbDeep(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[jsonbSafeString(key)] = sanitizeJsonbDeep(item, depth + 1)
  }
  return out
}

function cap(text: string, limit: number): string {
  let out = jsonbSafeString(redact(text))
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
  // Keyed by request_id because parallel subagents interleave (A, B, A) — a
  // single pending slot only dedupes consecutive runs and double-counts the
  // rest.
  pendingUsage: Map<string, Record<string, unknown>>
  // Requests already emitted: a trailing line for one of them must not queue a
  // second event.
  flushedUsage: Set<string>
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

// Drains every pending request in first-seen order.
function flushPendingUsage(ctx: ClaudeCtx): TypedEvent[] {
  if (ctx.pendingUsage.size === 0) return []
  const events: TypedEvent[] = []
  for (const [requestId, payload] of ctx.pendingUsage) {
    events.push({ kind: 'usage', payload })
    ctx.flushedUsage.add(requestId)
  }
  ctx.pendingUsage.clear()
  return events
}

function trackUsage(ctx: ClaudeCtx, line: ClaudeLine): void {
  const usage = line.message?.usage
  const requestId = typeof line.request_id === 'string' ? line.request_id : null
  if (!usage || !requestId) return
  if (ctx.flushedUsage.has(requestId)) return
  ctx.pendingUsage.set(requestId, usagePayload(usage, requestId, line.parent_tool_use_id))
}

function rememberTool(ctx: ClaudeCtx, toolUseId: string, name: string): void {
  ctx.toolNames.set(toolUseId, name)
  while (ctx.toolNames.size > TOOL_NAME_CAP) {
    const oldest = ctx.toolNames.keys().next()
    if (oldest.done) break
    ctx.toolNames.delete(oldest.value)
  }
}

function mapAssistantLine(ctx: ClaudeCtx, line: ClaudeLine): TypedEvent[] {
  trackUsage(ctx, line)
  const events: TypedEvent[] = []
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
      if (toolUseId) rememberTool(ctx, toolUseId, name)
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
    pendingUsage: new Map(),
    flushedUsage: new Set(),
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
      // A separator that never arrives must not become a memory leak.
      if (tail.length > TAIL_CAP) {
        raw += `${tail}\n`
        tail = ''
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
