import { z } from 'zod'
import {
  openKairosDialogue,
  prepareDialogueContext,
  appendDialogueTurn,
  commitDialogue,
} from '@/lib/kairos/dialogue'
import { loadDialogue } from '@/lib/data/dialogue'
import type { RegisterFn } from './types'
import { getUserId, ok, fail, notFound } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Dialogue — MCP tools. The threaded successor to the one-shot
// answer_kairos_ask loop, and the conversational form of the Claude-Code
// cognition pattern (prepare → synthesise in-context → commit).
//
// Flow (driven by the /kairos-dialogue skill):
//   open_dialogue            → seed a thread from a pending ask (or a topic)
//   prepare_dialogue_context → pack seed + history + retrieval for Kairos's turn
//   append_dialogue_turn     → record a turn (operator or kairos)
//   commit_dialogue          → distill the thread into reflections, close it
//
// Synthesis-surface only — NOT part of the Gantt MCP/REST parity invariant.
// ─────────────────────────────────────────────────────────────────────────

export const registerDialogueTools: RegisterFn = (server) => {
  server.tool(
    'open_dialogue',
    'Open (or resume) a multi-turn Kairos dialogue. Pass questionMemoryId to seed it from a pending kairos-ask — the question becomes Kairos\'s opening turn and the thread links back to the ask (idempotent: one open dialogue per ask). Or pass a topic (with optional dominionId) to start a free-standing conversation. Returns the threadId to drive with prepare_dialogue_context / append_dialogue_turn / commit_dialogue.',
    {
      questionMemoryId: z.string().uuid().optional().describe('Pending kairos-ask to seed the dialogue from.'),
      topic: z.string().trim().min(1).max(500).optional().describe('Free-standing topic (used when no questionMemoryId).'),
      dominionId: z.string().uuid().optional().describe('Anchor a free-standing dialogue to a Dominion (enables per-turn retrieval). Ignored when seeding from an ask.'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const result = await openKairosDialogue(uid, {
        questionMemoryId: args.questionMemoryId,
        topic: args.topic,
        dominionId: args.dominionId,
      })
      if (!result.ok) {
        if (result.reason === 'ask_not_found') return notFound('Pending Kairos question')
        return fail('open_dialogue: provide either questionMemoryId or a topic.')
      }
      return ok({ threadId: result.threadId, created: result.created, opening: result.opening })
    },
  )

  server.tool(
    'prepare_dialogue_context',
    'Pack everything needed to author Kairos\'s next turn in a dialogue: the seed Aether thought + its grounding memories + the global core narrative, the full turn history, and fresh retrieval (cortex / archetypes / substrate) keyed on the latest operator turn. Workflow: call this → compose Kairos\'s reply yourself, grounded in the bundle → append_dialogue_turn(role:"kairos"). This is the Claude-Code cognition path — no BYOK key.',
    { threadId: z.string().uuid().describe('The dialogue thread id from open_dialogue.') },
    async (args, extra) => {
      const uid = getUserId(extra)
      const ctx = await prepareDialogueContext(uid, args.threadId)
      if (!ctx) return notFound('Dialogue')
      return ok(ctx)
    },
  )

  server.tool(
    'append_dialogue_turn',
    'Record one turn in a dialogue. role="operator" for the operator\'s message, role="kairos" for Kairos\'s reply (the one you synthesised from prepare_dialogue_context). citations are optional memory ids the turn drew on. Turns are ordered and persisted on the thread.',
    {
      threadId: z.string().uuid().describe('The dialogue thread id.'),
      role: z.enum(['operator', 'kairos']).describe('Who is speaking.'),
      content: z.string().trim().min(1).max(20000).describe('The turn text — markdown supported.'),
      citations: z.array(z.string().uuid()).optional().describe('Memory ids this turn cited.'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const res = await appendDialogueTurn(uid, args.threadId, args.role, args.content, args.citations)
      if (!res.ok) return notFound('Dialogue')
      return ok({ seq: res.seq, turnId: res.turnId })
    },
  )

  server.tool(
    'get_dialogue',
    'Read a dialogue thread and all its turns (no synthesis, no new turn). Use from a delivery surface or to resume an in-flight conversation.',
    { threadId: z.string().uuid().describe('The dialogue thread id.') },
    async (args, extra) => {
      const uid = getUserId(extra)
      const loaded = await loadDialogue(uid, args.threadId)
      if (!loaded) return notFound('Dialogue')
      return ok({
        thread: {
          id: loaded.thread.id,
          title: loaded.thread.title,
          dominionId: loaded.thread.dominionId,
          status: loaded.thread.status,
          kairosAskId: loaded.thread.seed.kairosAskId,
          createdAt: loaded.thread.createdAt,
        },
        turns: loaded.turns.map((t) => ({ seq: t.seq, role: t.role, content: t.content, createdAt: t.createdAt })),
      })
    },
  )

  server.tool(
    'commit_dialogue',
    'Distill a finished dialogue into durable memory. YOU (Claude Code) supply the reflections drawn from the exchange. PREFER soft auto-tagging over hard pinning: pass dominionIds (every Dominion the insight touches) and leave dominionId null for cross-front insights — the reflection then surfaces from each of those Dominions\' retrieval without being owned by one. Set dominionId only when there is a genuine single "home". The server persists them as reflections tagged kairos-dialogue (+ dominion:<id> reference tags), links them to the seed ask, marks that ask answered, and closes the thread. This is the conversational analogue of commit_aether.',
    {
      threadId: z.string().uuid().describe('The dialogue thread id.'),
      reflections: z.array(z.object({
        dominionId: z.string().uuid().nullable().optional().describe('Optional "home" Dominion (anchors the FK). Often null for cross-front reflections — prefer dominionIds.'),
        dominionIds: z.array(z.string().uuid()).optional().describe('Every Dominion this insight touches — written as soft reference tags so it surfaces from each. Invalid/foreign ids are dropped.'),
        bodyMd: z.string().trim().min(1).max(10000).describe('The distilled insight — markdown.'),
        title: z.string().trim().max(255).optional().describe('Optional title; defaults to the first line.'),
        summary: z.string().trim().max(2000).optional().describe('Optional one-line summary.'),
        tags: z.array(z.string()).optional().describe('Extra tags (kairos-dialogue is always added).'),
      })).min(1).max(10).describe('One or more reflections distilled from the conversation.'),
      closeAsk: z.boolean().optional().describe('Mark the originating kairos-ask answered (default true).'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const result = await commitDialogue(uid, args.threadId, {
        reflections: args.reflections,
        closeAsk: args.closeAsk,
      })
      if (!result.ok) {
        if (result.reason === 'thread_not_found') return notFound('Dialogue')
        if (result.reason === 'dominion_not_found') return notFound('Dominion')
        return fail('commit_dialogue: provide at least one reflection.')
      }
      return ok({ reflectionIds: result.reflectionIds, closedAsk: result.closedAsk })
    },
  )
}
