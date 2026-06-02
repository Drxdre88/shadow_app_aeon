import { z } from 'zod'
import { captureReflection } from '@/lib/data/memories'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (B3) — kairos_reflect MCP tool.
//
// One-shot tool for the operator to fire a *reflection* into a Dominion
// from any Claude Code session (or any future MCP client). Reflections are
// the highest-weight signal in the brain — they shape archetype synthesis
// (B1) and the cortex regen (B2) as a chronological *trail* showing how
// the operator's thinking has evolved.
//
// Why a dedicated tool instead of overloading create_memory:
//   - streamClass='reflection' is the contract here, not a hint. The tool
//     name + description make the intent explicit and the call site
//     unambiguous in agent transcripts ("fire a reflection" vs "save a note").
//   - The default title is auto-derived from the body so the operator can
//     dump text without naming things — friction-free capture is the point.
//   - The dominionId is required: a floating reflection with no anchor
//     is useless to synthesis. Forcing the anchor at the type level
//     prevents accidental orphans.
//
// See docs/kairos/12-kairos-evolution-plan.md §"Reflections — the owner's
// signal" and docs/kairos/14-quality-gates.md §5 (reflection weight).
// ─────────────────────────────────────────────────────────────────────────

export const registerReflectionTools: RegisterFn = (server) => {
  server.tool(
    'kairos_reflect',
    'Fire a *reflection* into a Dominion — the highest-weight signal in the Kairos brain. ' +
      'Use this when the operator states a belief, priority, observation, or correction ("we\'re leaning GBM for vol regime", ' +
      '"mobile is parked", "stop flagging X as drift"). The reflection becomes part of the operator\'s belief trail and ' +
      'will weight archetype + cortex synthesis. Anchored to a single Dominion. Use list_dominions to find the right id.',
    {
      dominionId: z.string().uuid().describe('Dominion UUID to anchor this reflection to'),
      bodyMd: z.string().trim().min(1).max(100_000).describe('The reflection content — markdown supported. Plain text is fine.'),
      title: z.string().min(1).max(255).optional().describe('Optional short label. Defaults to the first line of bodyMd (≤80 chars).'),
      summary: z.string().min(1).max(1000).optional().describe('Optional one-line compression used by context packing.'),
      tags: z.array(z.string().min(1).max(50)).max(20).optional().describe('Optional free-form tags, e.g. ["belief", "ml-direction"]'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const result = await captureReflection(uid, {
        dominionId: args.dominionId,
        bodyMd: args.bodyMd,
        title: args.title ?? null,
        summary: args.summary ?? null,
        tags: args.tags,
        source: 'claude',
      })
      if (!result.ok) {
        if (result.reason === 'dominion_not_found') return notFound('Dominion')
        return fail(`kairos_reflect: ${result.reason}`)
      }
      return ok({
        id: result.memory.id,
        title: result.memory.title,
        dominionId: result.memory.dominionId,
        type: result.memory.type,
        streamClass: result.memory.streamClass,
        source: result.memory.source,
        createdAt: result.memory.createdAt,
      })
    },
  )
}
