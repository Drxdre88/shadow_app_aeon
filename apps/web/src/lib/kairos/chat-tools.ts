// Agentic READ-ONLY tools for the Kairos chat turn (WP2, flag-gated by
// KAIROS_CHAT_AGENTIC_TOOLS). Each tool is a userId-bound closure over the
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
import { searchMemoriesFts } from '@/lib/data/memories'
import { findProjects } from '@/lib/data/projects'
import {
  fetchLiveBoardContext,
  renderLiveBoardSection,
} from '@/lib/kairos/chat-board-context'
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

export const searchBrainInputSchema = z.object({
  query: z.string().trim().min(2).max(500),
})

export const listBoardsInputSchema = z.object({})

export const boardStateInputSchema = z.object({
  projectId: z.string().uuid(),
})

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
        'Full-text search the operator\'s memory brain. Returns ranked hits with titles and snippet excerpts. Use for prior context, decisions, and reflections.',
      inputSchema: searchBrainInputSchema,
      execute: async (input: z.infer<typeof searchBrainInputSchema>) => {
        const { hits } = await searchMemoriesFts(userId, {
          query: input.query,
          limit: SEARCH_BRAIN_LIMIT,
          offset: 0,
        })
        return JSON.stringify(hits.map((h) => ({
          id: h.id,
          title: h.title,
          type: h.type,
          snippet: h.snippet || h.summary || '',
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

// Bounded agentic loop: up to MAX_TOOL_ROUNDS provider calls WITH tools;
// any round without tool calls is the answer. If the model is still asking
// for tools after the cap, one final tool-less call forces a text answer.
export async function runChatToolLoop(
  provider: AIProvider,
  messages: AIMessage[],
  tools: Record<string, ChatTool>,
  opts: { maxOutputTokens?: number } = {},
): Promise<AIResponse> {
  const maxOutputTokens = opts.maxOutputTokens ?? 2000
  const providerTools = toProviderTools(tools)
  const convo = [...messages]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await provider.ask({
      messages: convo,
      maxOutputTokens,
      tools: providerTools,
    })
    const calls = response.toolCalls ?? []
    if (calls.length === 0) return response

    convo.push({ role: 'assistant', content: renderAssistantToolTurn(response.text, calls) })
    for (const call of calls) {
      const result = await executeToolCall(tools, call)
      convo.push({ role: 'user', content: `[tool_result ${call.toolName}]\n${result}` })
    }
  }

  return provider.ask({ messages: convo, maxOutputTokens })
}
