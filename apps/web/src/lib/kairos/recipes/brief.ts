import type { Recipe, RecipeContext, RecipeOutput } from './_recipe'
import { BRIEF_SYSTEM_PROMPT, buildBriefUserPrompt, type BriefAetherDigest, type BriefingContext } from '../briefer'
import type { AetherPayload } from '../aether-types'
import { getProviderForTask } from '@/lib/ai/route-task'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 3C — BRIEF recipe.
//
// Ports the existing briefer BYOK call into the recipe contract. Reuses
// buildPrompt + BriefingContext from briefer.ts so the system prompt and
// output format match the legacy path; the dispatcher drives the I/O
// (retrieval + grounding + memory write + trace).
//
// P2.5 G5: the prompt also reads the Dominion's latest cortex
// (ctx.retrieval.cortex), the latest Aether (ctx.grounding.aether — top
// tensions + threads, short) and the conscience block filtered to this
// Dominion (ctx.grounding.conscience). Output format is unchanged — the daily
// message reads each brief's first lines.
//
// Doc 20 §2.1.
// ─────────────────────────────────────────────────────────────────────────

const AETHER_TENSIONS = 2
const AETHER_THOUGHTS = 3

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Short Aether digest: narrative, top tensions, and top threads — this
// Dominion's first, then cross-cutting ones, by salience.
export function digestAether(payload: AetherPayload | null | undefined, dominionId: string): BriefAetherDigest | null {
  if (!payload) return null
  const thoughts = Array.isArray(payload.thoughts) ? payload.thoughts : []
  const titleOf = new Map(thoughts.map((t) => [t.id, t.title]))
  const tensions = (Array.isArray(payload.tensions) ? payload.tensions : [])
    .slice(0, AETHER_TENSIONS)
    .map((t) => {
      const a = titleOf.get(t.aId)
      const b = titleOf.get(t.bId)
      return a && b ? `${a} ↔ ${b}: ${t.note}` : t.note
    })
    .filter((s) => typeof s === 'string' && s.trim())
  const rank = (t: (typeof thoughts)[number]) => (t.dominionId === dominionId ? 0 : t.dominionId === null ? 1 : 2)
  const top = [...thoughts]
    .filter((t) => rank(t) < 2)
    .sort((x, y) => rank(x) - rank(y) || (y.salience ?? 0) - (x.salience ?? 0))
    .slice(0, AETHER_THOUGHTS)
    .map((t) => ({ title: t.title, insight: t.insight, dominionName: t.dominionName ?? null }))
  const narrative = typeof payload.coreNarrative === 'string' ? payload.coreNarrative : ''
  if (!narrative.trim() && tensions.length === 0 && top.length === 0) return null
  return { narrative, tensions, thoughts: top }
}

export interface BriefGroundingFlags {
  cortex: boolean
  aether: boolean
  conscience: boolean
}

export interface BriefRequest {
  system: string
  prompt: string
  date: string
  dominionName: string
  grounding: BriefGroundingFlags
}

// The exact system + user prompt for one Dominion's brief — shared by flat()
// (paid key) and the thinking queue's brief job (Max routine).
export function buildBriefRequest(ctx: RecipeContext, date: string = todayIso()): BriefRequest {
  const bundle = ctx.retrieval.bundle
  if (!bundle) {
    // The dispatcher catches; cron loop records skipped/errored per Dominion.
    throw new Error(`BRIEF: no Dominion bundle for ${ctx.dominionId}`)
  }

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
    cortex: ctx.retrieval.cortex ? { title: ctx.retrieval.cortex.title, body: ctx.retrieval.cortex.body } : null,
    aether: digestAether(ctx.grounding?.aether, ctx.dominionId),
    conscience: ctx.grounding?.conscience ?? '',
  }

  return {
    system: BRIEF_SYSTEM_PROMPT,
    prompt: buildBriefUserPrompt(briefingCtx, date),
    date,
    dominionName: bundle.name,
    grounding: {
      cortex: briefingCtx.cortex !== null,
      aether: briefingCtx.aether !== null,
      conscience: !!briefingCtx.conscience,
    },
  }
}

export interface BriefOutputInput {
  text: string
  date: string
  dominionName: string
  dominionId: string
  model: string
  grounding: BriefGroundingFlags
  // Extra trace fields (e.g. the thinking job that answered it).
  traceMeta?: Record<string, unknown>
}

// The persisted brief, whoever wrote the text — the externalId is the
// per-(date × Dominion) idempotency key and briefingDate is what the
// dashboard and the daily message read today's briefs by.
export function briefOutput(input: BriefOutputInput): RecipeOutput {
  return {
    primary: {
      type: 'advisory',
      streamClass: 'advisory',
      source: 'cron',
      title: `${input.date} · ${input.dominionName} briefing`,
      bodyMd: input.text,
      dominionId: input.dominionId,
      sourceMetadata: {
        externalId: `briefer:${input.date}:${input.dominionId}`,
        briefingDate: input.date,
        dominionId: input.dominionId,
      },
    },
    traceMeta: {
      date: input.date,
      model: input.model,
      grounding: input.grounding,
      ...input.traceMeta,
    },
  }
}

async function flat(ctx: RecipeContext): Promise<RecipeOutput> {
  const req = buildBriefRequest(ctx)

  const { provider } = await getProviderForTask(ctx.userId, {
    taskType: 'brief',
    dominionId: ctx.dominionId,
  })
  const response = await provider.ask({
    system: req.system,
    prompt: req.prompt,
    cacheSystem: true,
    maxTokens: 1200,
  })
  const text = response.text.trim()
  if (!text) throw new Error('BRIEF: empty response from provider')

  return briefOutput({
    text,
    date: req.date,
    dominionName: req.dominionName,
    dominionId: ctx.dominionId,
    model: response.modelId,
    grounding: req.grounding,
  })
}

export const BRIEF: Recipe = {
  name: 'BRIEF',
  description:
    'Daily morning briefing for one Dominion. Reads the live snapshot ' +
    '(vision / mission / objectives / projects / recent memories / open board cards), ' +
    "the Dominion's latest cortex, the latest Aether (top tensions + threads) and the " +
    'conscience block (constitution principles + held beliefs, Dominion first), ' +
    'and produces a 150–280 word markdown advisory in four sections (State / Movement / Watch / Suggested next). ' +
    'Idempotent per (date × dominionId).',
  reads: ['cortex', 'aether', 'constitution', 'belief', 'execution', 'reflection'],
  writes: ['advisory'],
  flat,
}
