// Agentic tools for the Kairos chat turn (WP2, default ON —
// KAIROS_CHAT_AGENTIC_TOOLS is a kill switch: set to '0'/'false' to opt back
// out to the plain no-tools call). Each tool is a userId-bound closure over the
// existing data layer. Every tool is READ-ONLY except ONE: undo_kairos_change
// (docs/kairos/34 §6), the operator's veto over a promote/decay/merge — it
// only acts on an explicit operator request and with confirm:true plus the
// server-minted confirmToken from a confirm:false lookup, and it
// logs its revert like the MCP revert_memory_op. The loop is caller-owned:
// the provider only forwards tool definitions (see AIToolSpec in
// lib/ai/provider.ts) and hands requested calls back, so round caps and
// result serialization live here.
//
// Tool exchanges are re-serialized into plain-text messages between rounds
// (AIMessage carries strings only). This sidesteps provider-specific
// tool_use/tool_result pairing protocols at a small fidelity cost — fine for
// a max-4-round lookup loop.

import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listRecentMemories } from '@/lib/data/memories'
import { listMemoryOps } from '@/lib/data/memory-ops'
import { loadMemoryTitles } from '@/lib/data/memory-rescore'
import { findProjects } from '@/lib/data/projects'
import { listAgentSessions } from '@/lib/data/sessions'
import { listTraceHistory } from '@/lib/data/recipes'
import {
  fetchLiveBoardContext,
  renderLiveBoardSection,
} from '@/lib/kairos/chat-board-context'
import { fetchRecentActivityContext } from '@/lib/kairos/chat-recency-context'
import { searchSubstrateForChat } from '@/lib/kairos/retrieve'
import { SYNTHESIS_HEALTH_RECIPE } from '@/lib/kairos/synthesis-health'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  AIMessage,
  AIProvider,
  AIResponse,
  AIToolCall,
  AIToolSpec,
} from '@/lib/ai/provider'

export const MAX_TOOL_ROUNDS = 4
const SEARCH_BRAIN_LIMIT = 8
const LIST_BOARDS_LIMIT = 200
const RECENT_ACTIVITY_MIN_HOURS = 1
const RECENT_ACTIVITY_MAX_HOURS = 168
const RECENT_ACTIVITY_DEFAULT_HOURS = 24
// listSessionsSchema caps limit at 100 — match it rather than pass an
// out-of-range value straight to the data layer.
const AGENT_SESSIONS_LIMIT = 100
// Wall-clock budget for the whole tool loop, not per-round — a chain of slow
// tool calls (DB + provider round-trips) must never stall a chat reply
// indefinitely. Checked before firing each round; the loop still forces one
// final tool-less call to get an answer out of whatever was gathered so far.
const TOOL_LOOP_BUDGET_MS = 30_000
// Hard ceiling on total wall time, enforced independently of the round-start
// budget above: TOOL_LOOP_BUDGET_MS only gates whether a NEW round starts, so
// a single slow in-flight provider.ask (network stall, provider outage) could
// otherwise block indefinitely with no round-start check ever firing again.
// Every provider.ask call in this module — each round AND the mandatory
// trailing call — races against the remaining slice of this ceiling; a
// timeout breaks out of the loop (or, for the trailing call, returns a
// synthetic fallback) instead of throwing.
const TOOL_LOOP_HARD_DEADLINE_MS = 45_000

export const searchBrainInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
})

export const listBoardsInputSchema = z.object({})

export const boardStateInputSchema = z.object({
  projectId: z.string().uuid(),
})

export const recentActivityInputSchema = z.object({
  hours: z.number().int().min(RECENT_ACTIVITY_MIN_HOURS).max(RECENT_ACTIVITY_MAX_HOURS).optional(),
})

export const synthesisStatusInputSchema = z.object({})

export const undoKairosChangeInputSchema = z.object({
  title: z.string().trim().min(2).max(300),
  confirm: z.boolean(),
  confirmToken: z.string().trim().max(300).optional(),
})

const UNDO_OPS = ['promote', 'decay', 'merge']
// Only the nightly engine's own ops are undoable here: BackUpStep ('backup')
// logs promote/decay, MergeStep ('merge') logs merge. Own-mind mirror ops
// (step 'beliefs', before null) and constitution ops (step 'constitution')
// share the op names but are not chat-vetoable.
const UNDO_STEPS = ['backup', 'merge']
const UNDO_SCAN_LIMIT = 100
const UNDO_MAX_CANDIDATES = 3
const UNDO_MIN_SCORE = 0.6
// Non-exact matches must share at least this many tokens with the title, so
// one common word ("work") can never select a change on its own.
const UNDO_MIN_SHARED_TOKENS = 2
const UNDO_TOKEN_TTL_MS = 10 * 60 * 1000

function undoTokenSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || null
}

function undoTokenMac(secret: string, userId: string, opId: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`undo_kairos_change:${userId}:${opId}:${expiresAt}`).digest('hex')
}

// Confirmation token minted by the confirm:false lookup: binds the operator's
// confirmation to exactly one op for this user, valid for 10 minutes.
export function mintUndoConfirmToken(userId: string, opId: string, now: number = Date.now()): string | null {
  const secret = undoTokenSecret()
  if (!secret) return null
  const expiresAt = now + UNDO_TOKEN_TTL_MS
  return `${opId}.${expiresAt}.${undoTokenMac(secret, userId, opId, expiresAt)}`
}

// Returns the opId the token authorises, or null when forged/expired/foreign.
export function verifyUndoConfirmToken(userId: string, token: string, now: number = Date.now()): string | null {
  const secret = undoTokenSecret()
  if (!secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [opId, exp, mac] = parts as [string, string, string]
  const expiresAt = Number(exp)
  if (!opId || !Number.isSafeInteger(expiresAt) || expiresAt < now) return null
  const expected = Buffer.from(undoTokenMac(secret, userId, opId, expiresAt), 'hex')
  const given = Buffer.from(mac, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return opId
}

export interface UndoCandidate {
  opId: string
  op: string
  memoryId: string
  title: string
  createdAt: Date
  reason: string
}

function undoTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1))]
}

// 1 = exact title; 0.9 = one contains the other; else the share of the
// query's tokens present in the title. Anything but an exact title needs
// ≥ UNDO_MIN_SHARED_TOKENS shared tokens, else 0.
function undoMatchScore(query: string, title: string): number {
  const q = query.trim().toLowerCase()
  const t = title.trim().toLowerCase()
  if (!q || !t) return 0
  if (q === t) return 1
  const qTokens = undoTokens(q)
  if (qTokens.length === 0) return 0
  const tTokens = new Set(undoTokens(t))
  const shared = qTokens.filter((tok) => tTokens.has(tok)).length
  if (shared < UNDO_MIN_SHARED_TOKENS) return 0
  if (t.includes(q) || q.includes(t)) return 0.9
  return shared / qTokens.length
}

/**
 * Pick the op to undo for an operator's title. `candidates` are newest first;
 * only the newest op per memory counts. One clear best → match; ties at the
 * best score → ambiguous (≤ 3 listed); nothing above the floor → none.
 */
export function matchUndoCandidate(
  query: string,
  candidates: readonly UndoCandidate[],
): { kind: 'match'; candidate: UndoCandidate } | { kind: 'ambiguous'; candidates: UndoCandidate[] } | { kind: 'none' } {
  const seen = new Set<string>()
  const scored: Array<{ c: UndoCandidate; score: number }> = []
  for (const c of candidates) {
    if (seen.has(c.memoryId)) continue
    seen.add(c.memoryId)
    const score = undoMatchScore(query, c.title)
    if (score >= UNDO_MIN_SCORE) scored.push({ c, score })
  }
  if (scored.length === 0) return { kind: 'none' }
  const best = Math.max(...scored.map((s) => s.score))
  const top = scored.filter((s) => s.score === best)
  if (top.length === 1) return { kind: 'match', candidate: top[0]!.c }
  return { kind: 'ambiguous', candidates: top.slice(0, UNDO_MAX_CANDIDATES).map((s) => s.c) }
}

async function listUndoCandidates(userId: string): Promise<UndoCandidate[]> {
  const ops = await listMemoryOps(userId, { ops: UNDO_OPS, steps: UNDO_STEPS, limit: UNDO_SCAN_LIMIT })
  // before == null means nothing to restore (revert refuses it) — never offer it.
  const withMemory = ops.filter((o): o is typeof o & { memoryId: string } =>
    typeof o.memoryId === 'string' && UNDO_STEPS.includes(o.step) && o.before != null)
  const titles = await loadMemoryTitles(userId, withMemory.map((o) => o.memoryId))
  return withMemory.flatMap((o) => {
    const title = titles.get(o.memoryId)
    return title
      ? [{ opId: o.id, op: o.op, memoryId: o.memoryId, title, createdAt: o.createdAt, reason: o.reason }]
      : []
  })
}

const OP_VERB: Record<string, string> = { promote: 'promoted', decay: 'decayed', merge: 'merged' }

function describeUndo(c: UndoCandidate) {
  return { title: c.title, change: OP_VERB[c.op] ?? c.op, at: c.createdAt, why: c.reason }
}

// Method-shorthand `execute` keeps assignment bivariant, so per-tool
// executors typed to their own schema output fit the unknown-typed record.
export interface ChatTool<Schema extends z.ZodType = z.ZodType> {
  description: string
  inputSchema: Schema
  execute(input: z.infer<Schema>): Promise<string>
}

export function buildChatTools(userId: string): Record<string, ChatTool> {
  return {
    search_brain: {
      description:
        'Search the operator\'s memory brain (hybrid semantic + full-text, confidence and recency weighted). Returns ranked hits with titles and body excerpts. Use for prior context, decisions, and reflections.',
      inputSchema: searchBrainInputSchema,
      execute: async (input: z.infer<typeof searchBrainInputSchema>) => {
        const hits = await searchSubstrateForChat(userId, input.query, SEARCH_BRAIN_LIMIT)
        return JSON.stringify(hits.map((h) => ({
          id: h.id,
          title: h.title,
          streamClass: h.streamClass,
          snippet: h.body.slice(0, 500),
          createdAt: h.createdAt,
        })))
      },
    },
    list_boards: {
      description: 'List the operator\'s project boards (id + name).',
      inputSchema: listBoardsInputSchema,
      execute: async () => {
        const projects = await findProjects(userId, LIST_BOARDS_LIMIT)
        return JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name })))
      },
    },
    board_state: {
      description:
        'Live state of one project board: task counts by status plus the most recently updated open cards. Authoritative over any memory.',
      inputSchema: boardStateInputSchema,
      execute: async (input: z.infer<typeof boardStateInputSchema>) => {
        const context = await fetchLiveBoardContext(userId, input.projectId)
        if (!context) return JSON.stringify({ error: 'project not found or not accessible' })
        return renderLiveBoardSection([context])
      },
    },
    recent_activity: {
      description:
        'What has happened in the last N hours (default 24, 1-168): coding sessions, reflections, introspection proposals, asks dispatched, board task completions/creations, and a per-repo breakdown of agent sessions. Fresher than search_brain — use this for "what did I do today/this week" questions.',
      inputSchema: recentActivityInputSchema,
      execute: async (input: z.infer<typeof recentActivityInputSchema>) => {
        const hours = input.hours ?? RECENT_ACTIVITY_DEFAULT_HOURS
        const since = new Date(Date.now() - hours * 60 * 60 * 1000)
        const [ctx, sessions] = await Promise.all([
          fetchRecentActivityContext(userId, { hours }),
          listAgentSessions(userId, { since, liveOnly: false, limit: AGENT_SESSIONS_LIMIT, offset: 0 }),
        ])
        const agentSessionsByRepo: Record<string, number> = {}
        for (const s of sessions) {
          const key = s.repo ?? 'unknown'
          agentSessionsByRepo[key] = (agentSessionsByRepo[key] ?? 0) + 1
        }
        return JSON.stringify({
          windowHours: hours,
          sessionSummaries: ctx?.sessionSummaries ?? { count: 0, items: [] },
          reflections: ctx?.reflections ?? { count: 0, items: [] },
          introspectionProposals: ctx?.introspectionProposals ?? { count: 0, items: [] },
          asks: ctx?.asks ?? { count: 0, items: [] },
          boardTasksCompleted: ctx?.boardTasksCompleted ?? 0,
          boardTasksCreated: ctx?.boardTasksCreated ?? 0,
          agentSessionsByRepo,
        })
      },
    },
    synthesis_status: {
      description:
        'Kairos self-certifies his own overnight synthesis health: the latest SYNTHESIS_HEALTH rollup, and whether today\'s cortex (any Dominion) and Aether self-model docs exist. Use this instead of guessing at brain health from stale narrative.',
      inputSchema: synthesisStatusInputSchema,
      execute: async () => {
        const now = new Date()
        const todayStart = new Date(`${todayIso()}T00:00:00.000Z`)
        const todayWindow = { start: todayStart, end: now }
        const [rollup, cortexToday, aetherToday] = await Promise.all([
          listTraceHistory(userId, { recipe: SYNTHESIS_HEALTH_RECIPE, limit: 1 }),
          listRecentMemories(userId, [eq(memories.streamClass, 'cortex')], todayWindow, 1),
          listRecentMemories(userId, [eq(memories.streamClass, 'aether')], todayWindow, 1),
        ])
        const latest = rollup[0]
        return JSON.stringify({
          rollup: latest ? { createdAt: latest.createdAt, sourceMetadata: latest.sourceMetadata } : null,
          cortexDocToday: cortexToday.length > 0,
          aetherDocToday: aetherToday.length > 0,
        })
      },
    },
    // The ONE mutating tool. Two-step, server-enforced: confirm:false looks
    // up the match and mints a 10-minute confirmToken bound to that exact op
    // and user; only confirm:true WITH that token reverts it (the operator's
    // veto), and it reverts the token's op — never a fresh title match.
    // Tool results don't persist across chat turns, so once the operator
    // confirms, the model re-runs confirm:false then confirm:true in that turn.
    undo_kairos_change: {
      description:
        'Undo (veto) something Kairos learned: reverts the most recent promotion ("I now believe X"), decay or merge whose memory title matches. Use ONLY when the operator explicitly asks to undo/veto/forget something Kairos learned — never on your own initiative. First call with confirm:false and show the operator the match; it returns a confirmToken. Only after the operator confirms that exact change, call with confirm:true and the confirmToken from a confirm:false lookup (re-run the lookup in that turn if you no longer have it). If several changes match, ask which one.',
      inputSchema: undoKairosChangeInputSchema,
      execute: async (input: z.infer<typeof undoKairosChangeInputSchema>) => {
        if (input.confirm) {
          const token = input.confirmToken
          if (!token) {
            return JSON.stringify({ status: 'refused', reason: 'confirm_token_required', message: 'Call with confirm:false first, show the operator the match, and pass its confirmToken once they confirm. Nothing was undone.' })
          }
          const opId = verifyUndoConfirmToken(userId, token)
          if (!opId) {
            return JSON.stringify({ status: 'refused', reason: 'invalid_or_expired_token', message: 'That confirmation is invalid or expired — look the change up again with confirm:false. Nothing was undone.' })
          }
          const target = (await listUndoCandidates(userId)).find((c) => c.opId === opId)
          if (!target) {
            return JSON.stringify({ status: 'not_found', message: 'That change is no longer undoable (already undone or superseded). Nothing was undone.' })
          }
          // Lazy: the revert module pulls the engine's write path, which the
          // read-only tools (and their importers) never need at load time.
          const { revertMemoryOp } = await import('@/lib/kairos/engine/revert')
          const res = await revertMemoryOp(userId, target.opId, { reason: 'operator veto (chat)' })
          if (!res.ok) {
            return JSON.stringify({ status: 'failed', reason: res.reason, match: describeUndo(target) })
          }
          return JSON.stringify({
            status: 'undone',
            message: `Undone: "${target.title}" is no longer ${OP_VERB[target.op] ?? target.op}, and Kairos won't redo it on its own.`,
            match: describeUndo(target),
          })
        }

        const found = matchUndoCandidate(input.title, await listUndoCandidates(userId))
        if (found.kind === 'none') {
          return JSON.stringify({ status: 'not_found', message: `No recent Kairos change matches "${input.title}". Nothing was undone.` })
        }
        if (found.kind === 'ambiguous') {
          return JSON.stringify({
            status: 'ambiguous',
            message: 'Several recent changes match — ask the operator which one. Nothing was undone.',
            candidates: found.candidates.map(describeUndo),
          })
        }
        const match = found.candidate
        const confirmToken = mintUndoConfirmToken(userId, match.opId)
        if (!confirmToken) {
          return JSON.stringify({ status: 'unavailable', message: 'Undo is unavailable (server confirmation secret missing). Nothing was undone.', match: describeUndo(match) })
        }
        return JSON.stringify({
          status: 'confirm_needed',
          message: `Found it. Ask the operator to confirm undoing this ${match.op}; only after they confirm, call again with confirm:true and this confirmToken (valid 10 minutes). Nothing was undone yet.`,
          match: describeUndo(match),
          confirmToken,
        })
      },
    },
  }
}

function toProviderTools(tools: Record<string, ChatTool>): Record<string, AIToolSpec> {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      { description: t.description, inputSchema: t.inputSchema },
    ]),
  )
}

// Errors (unknown tool, schema reject, executor throw) are fed back to the
// model as tool results rather than failing the turn — it can self-correct
// or answer without the lookup.
async function executeToolCall(
  tools: Record<string, ChatTool>,
  call: AIToolCall,
): Promise<string> {
  const tool = tools[call.toolName]
  if (!tool) return JSON.stringify({ error: `unknown tool: ${call.toolName}` })
  const parsed = tool.inputSchema.safeParse(call.input)
  if (!parsed.success) {
    return JSON.stringify({
      error: `invalid input: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    })
  }
  try {
    return await tool.execute(parsed.data)
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
  }
}

function renderAssistantToolTurn(text: string, calls: AIToolCall[]): string {
  const lines = calls.map((c) => `[tool_call ${c.toolName}] ${JSON.stringify(c.input)}`)
  return [text.trim(), ...lines].filter(Boolean).join('\n')
}

// Sentinel distinct from any real AIResponse so callers can branch on it
// without an `in`/typeof check on the response shape.
const DEADLINE_EXCEEDED = Symbol('tool-loop-deadline-exceeded')

// Runs `ask()` racing the remaining `ms` budget. `ms <= 0` resolves to the
// timeout sentinel WITHOUT ever calling `ask()` — no point starting a
// provider round-trip against an already-exhausted deadline. The timer is
// always cleared so a fast-resolving call never leaves a dangling handle.
function askWithDeadline(ask: () => Promise<AIResponse>, ms: number): Promise<AIResponse | typeof DEADLINE_EXCEEDED> {
  if (ms <= 0) return Promise.resolve(DEADLINE_EXCEEDED)
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<typeof DEADLINE_EXCEEDED>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_EXCEEDED), ms)
  })
  return Promise.race([ask(), timeout]).finally(() => clearTimeout(timer))
}

// Never-throw fallback for when even the trailing tool-less call can't beat
// the hard deadline — the operator still gets a reply, just an honest one
// about running out of time, instead of the chat turn failing outright.
function deadlineFallbackResponse(): AIResponse {
  return {
    text: "I ran out of time gathering context for this — I wasn't able to finish forming a full answer. Try asking again, or narrow the question.",
    providerId: 'kairos-chat-tool-loop',
    modelId: 'deadline-fallback',
  }
}

// Bounded agentic loop: up to MAX_TOOL_ROUNDS provider calls WITH tools;
// any round without tool calls is the answer. If the model is still asking
// for tools after the cap, one final tool-less call forces a text answer.
// Every provider.ask call — each round and the trailing call — is raced
// against the remaining slice of TOOL_LOOP_HARD_DEADLINE_MS so total wall
// time is genuinely bounded even if TOOL_LOOP_BUDGET_MS's round-start check
// never gets to fire again (e.g. one very slow in-flight call).
export async function runChatToolLoop(
  provider: AIProvider,
  messages: AIMessage[],
  tools: Record<string, ChatTool>,
  opts: { maxOutputTokens?: number } = {},
): Promise<AIResponse> {
  const maxOutputTokens = opts.maxOutputTokens ?? 2000
  const providerTools = toProviderTools(tools)
  const convo = [...messages]
  const startedAt = Date.now()
  let elapsedMs = 0

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    elapsedMs = Date.now() - startedAt
    if (elapsedMs > TOOL_LOOP_BUDGET_MS) {
      console.warn('[kairos-chat] tool loop budget exceeded, forcing final answer', { round, elapsedMs })
      break
    }
    const response = await askWithDeadline(
      () => provider.ask({ messages: convo, maxOutputTokens, tools: providerTools }),
      TOOL_LOOP_HARD_DEADLINE_MS - elapsedMs,
    )
    if (response === DEADLINE_EXCEEDED) {
      console.warn('[kairos-chat] tool loop hard deadline exceeded mid-round, forcing final answer', { round })
      break
    }
    const calls = response.toolCalls ?? []
    if (calls.length === 0) return response

    convo.push({ role: 'assistant', content: renderAssistantToolTurn(response.text, calls) })
    for (const call of calls) {
      const result = await executeToolCall(tools, call)
      convo.push({ role: 'user', content: `[tool_result ${call.toolName}]\n${result}` })
    }
  }

  const final = await askWithDeadline(
    () => provider.ask({ messages: convo, maxOutputTokens }),
    TOOL_LOOP_HARD_DEADLINE_MS - elapsedMs,
  )
  if (final === DEADLINE_EXCEEDED) {
    console.warn('[kairos-chat] tool loop hard deadline exceeded on final answer, returning fallback', { elapsedMs })
    return deadlineFallbackResponse()
  }
  return final
}
