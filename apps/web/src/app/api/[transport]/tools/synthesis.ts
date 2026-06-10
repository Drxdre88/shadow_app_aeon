import { fetchAetherInputs, persistAether } from '@/lib/kairos/aether'
import { aetherOutSchema } from '@/lib/kairos/aether-prompt'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type { AetherPayload } from '@/lib/kairos/aether-types'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos synthesis — the Claude-Code cognition path (BYOK-free).
//
// Kairos's higher-order synthesis (cortex / archetype / Aether) normally runs
// server-side through the operator's BYOK key. These tools invert that: Claude
// Code (already a capable reflect model with the brain mounted via MCP) reads
// the substrate, synthesises the payload ITSELF, and hands the finished
// structure back to be persisted with the correct type/streamClass — no key,
// no decryption, works anywhere a Claude Code session runs.
//
// Same write-back shape as kairos_reflect: a dedicated tool that forces the
// stream class (create_memory cannot, by design). Aether first; cortex +
// archetype follow the identical pattern.
// ─────────────────────────────────────────────────────────────────────────

export const registerSynthesisTools: RegisterFn = (server) => {
  server.tool(
    'prepare_aether_context',
    'Gather the full substrate for an Aether synthesis (the global self-model above ALL Dominions): every Dominion\'s latest cortex (with its structured currentState/driftSignals), the operator\'s highest-weight reflections, today\'s archetypes, and the prior Aether (for shift detection). Returns a structured bundle. Workflow: call this → synthesise an AetherPayload yourself → call commit_aether. This is the Claude-Code cognition path — no BYOK key required.',
    {},
    async (_args, extra) => {
      const uid = getUserId(extra)
      const inputs = await fetchAetherInputs(uid)
      return ok({
        cortexSnapshots: inputs.cortexSnapshots,
        topReflections: inputs.topReflections,
        archetypes: inputs.archetypes,
        prior: inputs.prior,
        counts: {
          cortices: inputs.cortexSnapshots.length,
          reflections: inputs.topReflections.length,
          archetypes: inputs.archetypes.length,
          hasPrior: Boolean(inputs.prior),
        },
      })
    },
  )

  server.tool(
    'commit_aether',
    'Persist a synthesised Aether — the single living self-model across all Dominions. YOU (Claude Code) supply the structured payload built from prepare_aether_context; the server only stores it (no LLM, no BYOK), forcing type/streamClass=\'aether\' and archiving the prior Aether. Every thought MUST cite real sourceMemoryIds (anti-drift) — ungrounded thoughts are dropped. Call prepare_aether_context first.',
    { payload: aetherOutSchema.describe('The synthesised AetherPayload: coreNarrative (global self-model prose), thoughts[] (each grounded in ≥1 real memory id), tensions[] (cross-Dominion), shifts[] (what changed vs the prior Aether).') },
    async (args, extra) => {
      const uid = getUserId(extra)
      const payload = args.payload as AetherPayload
      const grounded = payload.thoughts.filter((t) => t.sourceMemoryIds.length > 0)
      if (grounded.length === 0) {
        return fail('commit_aether: no grounded thoughts — every thought needs at least one real sourceMemoryId.')
      }
      const today = todayIso()
      const runId = `aether:claude_code:${uid}:${today}`
      const { aetherMemoryId, archivedPrior } = await persistAether(
        uid,
        { ...payload, thoughts: grounded },
        runId,
        today,
        'claude',
      )
      if (!aetherMemoryId) return fail('commit_aether: persist failed.')
      return ok({ aetherMemoryId, archivedPrior, thoughtsCommitted: grounded.length, today })
    },
  )
}
