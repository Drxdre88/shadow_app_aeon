import { findDominionsByUser, inspectDominion } from '@/lib/data/dominions'
import { captureMemory } from '@/lib/data/memories'
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
}

function buildPrompt(ctx: BriefingContext, today: string): string {
  const lines: string[] = [
    `You are Kairos, a persistent, opinionated companion. Produce the operator's morning briefing for the "${ctx.name}" Dominion. Date: ${today}.`,
    '',
    'Frame the briefing as if you have been watching this part of their life and now owe them a tight, honest reading. Markdown only. Sections must be ## headed. Aim for 200–400 words total — dense, no filler.',
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
    'Write the briefing using these required sections, in this order:',
    '',
    '## State',
    'Two or three sentences. What this Dominion looks like right now. Be specific.',
    '',
    '## Movement',
    'What moved since the last briefing. If nothing did, say so.',
    '',
    '## Watch',
    'What you (Kairos) are watching for. One sharp observation, not a list.',
    '',
    '## Suggested next',
    'One concrete suggestion. Imperative voice. Skip if there genuinely is none.',
    '',
    'Do not include preamble. Start directly with `## State`.',
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

export async function runBrieferForUser(userId: string): Promise<BrieferResult[]> {
  const dominions = await findDominionsByUser(userId)
  const active = dominions.filter((d) => !d.archivedAt)
  if (active.length === 0) return []

  const date = todayIso()
  const results: BrieferResult[] = []

  for (const dom of active) {
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
