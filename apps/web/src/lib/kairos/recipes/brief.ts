import type { Recipe, RecipeContext, RecipeOutput } from './_recipe'
import { BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt, type BriefingContext } from '../briefer'
import { getProviderForTask } from '@/lib/ai/route-task'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — BRIEF recipe.
//
// Ports the existing briefer BYOK call into the recipe contract. Reuses
// buildPrompt + BriefingContext from briefer.ts unchanged so the prompt
// and provider call shape match the legacy path bit-for-bit; the dispatcher
// drives the I/O (retrieval + memory write + trace).
//
// Doc 20 §2.1.
// ─────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

async function flat(ctx: RecipeContext): Promise<RecipeOutput> {
  const bundle = ctx.retrieval.bundle
  if (!bundle) {
    // The dispatcher catches; cron loop records skipped/errored per Dominion.
    throw new Error(`BRIEF: no Dominion bundle for ${ctx.dominionId}`)
  }

  const date = todayIso()

  const briefingCtx: BriefingContext = {
    name: bundle.name,
    vision: bundle.vision,
    missionLong: bundle.missionLong,
    objectives: bundle.objectives.map((o) => ({
      title: o.title,
      description: o.description,
      status: o.status,
    })),
    projects: bundle.projects.map((p) => ({ name: p.name })),
    recentMemories: bundle.recentMemories.map((m) => ({
      title: m.title,
      type: m.type,
      summary: m.summary,
    })),
    boardTasks: bundle.boardTasks.map((t) => ({
      name: t.name,
      status: t.status,
      priority: t.priority,
      projectName: t.projectName,
      endDate: t.endDate,
    })),
  }

  const { provider } = await getProviderForTask(ctx.userId, {
    taskType: 'brief',
    dominionId: ctx.dominionId,
  })
  const response = await provider.ask({
    system: BRIEF_SYSTEM_PROMPT,
    prompt: buildBriefUserPrompt(briefingCtx, date),
    cacheSystem: true,
    maxTokens: 1200,
  })
  const text = response.text.trim()
  if (!text) throw new Error('BRIEF: empty response from provider')

  return {
    primary: {
      type: 'advisory',
      streamClass: 'advisory',
      source: 'cron',
      title: `${date} · ${bundle.name} briefing`,
      bodyMd: text,
      dominionId: ctx.dominionId,
      sourceMetadata: {
        externalId: `briefer:${date}:${ctx.dominionId}`,
        briefingDate: date,
        dominionId: ctx.dominionId,
      },
    },
    traceMeta: { date, model: response.modelId },
  }
}

export const BRIEF: Recipe = {
  name: 'BRIEF',
  description:
    'Daily morning briefing for one Dominion. Reads the live snapshot ' +
    '(vision / mission / objectives / projects / recent memories / open board cards) ' +
    'and produces a 150–280 word markdown advisory in four sections (State / Movement / Watch / Suggested next). ' +
    'Idempotent per (date × dominionId).',
  reads: ['cortex', 'archetype', 'execution', 'reflection'],
  writes: ['advisory'],
  flat,
}
