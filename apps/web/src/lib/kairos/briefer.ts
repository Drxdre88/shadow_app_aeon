import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { captureMemory } from '@/lib/data/memories'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getProviderForTask } from '@/lib/ai/route-task'
import { AiCredentialMissingError } from '@/lib/ai/router'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 1 (E20) — daily Briefer.
//
// Fires once per active Dominion per user via the 7am cron. For each:
//   1. inspect_dominion to assemble the briefing context
//   2. routeTask({taskType:'brief'}) → heavy-tier BYOK model
//   3. Generate a markdown advisory
//   4. Persist as memory.type='advisory', source='cron', anchored to the
//      Dominion, idempotent on (date × dominionId)
//
// Idempotency: sourceMetadata.externalId = `briefer:${YYYY-MM-DD}:${dominionId}`
// captureMemory will return the existing advisory if today's already exists.
// ─────────────────────────────────────────────────────────────────────────

interface BriefingContext {
  name: string
  vision: string | null
  missionLong: string | null
  objectives: Array<{ title: string; description: string | null; status: string }>
  projects: Array<{ name: string }>
  recentMemories: Array<{ title: string; type: string; summary: string | null }>
  boardTasks: Array<{ name: string; status: string; priority: string; projectName: string; endDate: Date | null }>
}

function buildPrompt(ctx: BriefingContext, today: string): string {
  const lines: string[] = [
    `You are Kairos, a persistent, opinionated companion. Produce the operator's morning briefing for the "${ctx.name}" Dominion. Date: ${today}.`,
    '',
    'Frame the briefing as if you have been watching this part of their life and now owe them a tight, honest reading.',
    '',
    '── INPUT ──',
    '',
    '## Vision',
    ctx.vision || '(none set)',
    '',
    '## Mission',
    ctx.missionLong || '(none set)',
    '',
    '## Open objectives',
    ctx.objectives.length === 0
      ? '(none)'
      : ctx.objectives
          .map((o) => `- [${o.status}] ${o.title}${o.description ? ` — ${o.description}` : ''}`)
          .join('\n'),
    '',
    '## Projects',
    ctx.projects.length === 0 ? '(none)' : ctx.projects.map((p) => `- ${p.name}`).join('\n'),
    '',
    '## Recent memories',
    ctx.recentMemories.length === 0
      ? '(none)'
      : ctx.recentMemories
          .slice(0, 15)
          .map((m) => `- [${m.type}] ${m.title}${m.summary ? ` — ${m.summary}` : ''}`)
          .join('\n'),
    '',
    '## Open board cards (live)',
    ctx.boardTasks.length === 0
      ? '(none open)'
      : ctx.boardTasks
          .map((t) => {
            const due = t.endDate ? ` due ${new Date(t.endDate).toISOString().slice(0, 10)}` : ''
            return `- [${t.priority}/${t.status}] (${t.projectName}) ${t.name}${due}`
          })
          .join('\n'),
    '',
    '── OUTPUT FORMAT ──',
    '',
    'Markdown only. 150–280 words total. Dense, no filler. Four required sections in this order, each ## headed:',
    '',
    '## State',
    'One short paragraph (≤3 sentences) on what this Dominion looks like right now, followed by **2–4 bullets** of concrete specifics.',
    '',
    '## Movement',
    'One short paragraph on what moved since the last briefing, followed by **0–3 bullets** of specific moves. If nothing moved, say so plainly in one sentence and skip the bullets.',
    '',
    '## Watch',
    'One paragraph naming the single sharpest thing to watch. Wrap CRITICAL semantics in `**!...!**` for emphasis — overdue cards, stalled urgents, broken invariants, anything that should trip the operator. Use sparingly: at most two `**!...!**` spans per Watch section.',
    '',
    '## Suggested next',
    'One concrete suggestion. Imperative voice. Skip if there genuinely is none. Prefer suggestions tied to an actual open board card when one fits.',
    '',
    'Formatting rules (mandatory — the UI renders them):',
    '- Wrap **named entities** (project names, key numbers, time windows) in `**bold**` → renders bold-white',
    '- Wrap **stuck/overdue/risk semantics** in `**!critical!**` (with `!` inside the bold) → renders bold-red. Use sparingly: 1–2 per section max',
    '- Wrap **identifiers** (board card titles, dates like `2026-04-01`, status tags like `[high]` or `[todo]`) in backticks `` `...` `` → renders as a themed mono chip',
    '- Bullets where they help density; prose where it carries judgement',
    '- No preamble. Start directly with `## State`',
    '',
    'Worked example of the rhythm (do not copy the content, copy the rhythm):',
    '> `Gas Analysis [HG] [OC]` is marked **high** and due `2026-04-01` — that\'s **!two months overdue!** sitting on the live board. Either it\'s done and the card is lying, or it\'s quietly rotting under newer urgent work.',
  ]
  return lines.join('\n')
}

function todayIso(): string {
  // YYYY-MM-DD in UTC so cron-day matches across timezones.
  return new Date().toISOString().slice(0, 10)
}

export interface BrieferResult {
  dominionId: string
  dominionName: string
  status: 'created' | 'existing' | 'skipped'
  memoryId?: string
  reason?: string
}

export interface RunBrieferOpts {
  // Archive today's existing advisory per Dominion before generating so the
  // dedup (externalId = `briefer:{date}:{dominionId}`) lets a new one through.
  // Used by the "Regenerate today" path in the UI; the nightly cron leaves
  // this false so accidental double-fires stay idempotent.
  force?: boolean
}

export async function runBrieferForUser(
  userId: string,
  opts: RunBrieferOpts = {},
): Promise<BrieferResult[]> {
  const dominions = await findDominionsByUser(userId)
  const active = dominions.filter((d) => !d.archivedAt)
  if (active.length === 0) return []

  const date = todayIso()
  const results: BrieferResult[] = []

  for (const dom of active) {
    if (opts.force) {
      // Soft-archive today's existing advisory for this Dominion. captureMemory
      // skips archived rows in its dedup lookup, so the next capture creates
      // a fresh memory row with the new prompt/model output.
      await db
        .update(memories)
        .set({ archivedAt: new Date() })
        .where(and(
          eq(memories.userId, userId),
          eq(memories.type, 'advisory'),
          sql`${memories.sourceMetadata}->>'externalId' = ${`briefer:${date}:${dom.id}`}`,
          isNull(memories.archivedAt),
        ))
    }

    const briefing = await inspectDominion(dom.id, userId, { memoryLimit: 25 })
    if (!briefing) {
      results.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'not found' })
      continue
    }

    const ctx: BriefingContext = {
      name: briefing.name,
      vision: briefing.vision,
      missionLong: briefing.missionLong,
      objectives: briefing.objectives.map((o) => ({
        title: o.title,
        description: o.description,
        status: o.status,
      })),
      projects: briefing.projects.map((p) => ({ name: p.name })),
      recentMemories: briefing.recentMemories.map((m) => ({
        title: m.title,
        type: m.type,
        summary: m.summary,
      })),
      boardTasks: briefing.boardTasks.map((t) => ({
        name: t.name,
        status: t.status,
        priority: t.priority,
        projectName: t.projectName,
        endDate: t.endDate,
      })),
    }

    let text: string
    try {
      const { provider } = await getProviderForTask(userId, { taskType: 'brief', dominionId: dom.id })
      const response = await provider.ask({
        prompt: buildPrompt(ctx, date),
        maxTokens: 1200,
        temperature: 0.4,
      })
      text = response.text.trim()
    } catch (err) {
      if (err instanceof AiCredentialMissingError) {
        results.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'no BYOK credential' })
        continue
      }
      throw err
    }

    if (!text) {
      results.push({ dominionId: dom.id, dominionName: dom.name, status: 'skipped', reason: 'empty response' })
      continue
    }

    const { memory, created } = await captureMemory(userId, {
      title: `${date} · ${dom.name} briefing`,
      bodyMd: text,
      type: 'advisory',
      source: 'cron',
      dominionId: dom.id,
      sourceMetadata: {
        externalId: `briefer:${date}:${dom.id}`,
        briefingDate: date,
        dominionId: dom.id,
      },
    })

    results.push({
      dominionId: dom.id,
      dominionName: dom.name,
      status: created ? 'created' : 'existing',
      memoryId: memory.id,
    })
  }

  return results
}
