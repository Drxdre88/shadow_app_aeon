// Agentic READ-ONLY tools for the Kairos chat turn (WP2, default ON —
// KAIROS_CHAT_AGENTIC_TOOLS is a kill switch: set to '0'/'false' to opt back
// out to the plain no-tools call). Each tool is a userId-bound closure over the
// existing data layer — the model can look things up mid-turn but can never
// mutate. The loop is caller-owned: the provider only forwards tool
// definitions (see AIToolSpec in lib/ai/provider.ts) and hands requested
// calls back, so round caps and result serialization live here.
//
// Tool exchanges are re-serialized into plain-text messages between rounds
// (AIMessage carries strings only). This sidesteps provider-specific
// tool_use/tool_result pairing protocols at a small fidelity cost — fine for
// a max-4-round lookup loop.

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { memories } from '@/lib/db/schema'
import { listRecentMemories } from '@/lib/data/memories'
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
