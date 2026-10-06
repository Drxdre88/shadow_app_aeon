import type { PaybackBucket, PaybackView } from '@/lib/data/payback'
import type { PaybackPeriod } from '@/lib/data/validators/payback'

// Plain-English markdown for get_agent_payback / GET /api/v1/hangar/payback.

const PERIOD_LABEL: Record<PaybackPeriod, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' }

export const periodLabel = (period: PaybackPeriod): string => PERIOD_LABEL[period]

export const formatUsd = (value: number): string => `$${value.toFixed(2)}`

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** One-paragraph headline, e.g. "30 days: 42 missions, 31 finished, 6 failed, 5 stopped because the runner died." */
export function paybackHeadline(view: PaybackView): string {
  const t = view.totals
  const label = periodLabel(view.period)
  if (t.missions === 0) return `${label}: no Hangar missions.`
  const outcome = [
    plural(t.missions, 'mission', 'missions'),
    `${t.succeeded} finished`,
    `${t.failed} failed`,
    `${t.runnerDied} stopped because the runner died`,
  ]
  const live = t.running + t.queued
  if (live > 0) outcome.push(`${live} still running or waiting`)
  const withCost = t.missions - t.missionsWithUnknownCost
  const cost = withCost > 0
    ? `Known cost ${formatUsd(t.costKnownUsd)} across ${plural(withCost, 'mission', 'missions')}; ${t.missionsWithUnknownCost} had no cost recorded.`
    : 'No cost was recorded for any of them.'
  const per = t.costPerSucceeded === null ? '' : ` About ${formatUsd(t.costPerSucceeded)} per finished mission.`
  return `${label}: ${outcome.join(', ')}. ${cost}${per}`
}

function bucketLine(b: PaybackBucket): string {
  const cost = b.missions - b.missionsWithUnknownCost > 0 ? formatUsd(b.costKnownUsd) : 'cost unknown'
  return `- **${b.key}**: ${plural(b.missions, 'mission', 'missions')} (${b.succeeded} finished, ${b.failed} failed, ${b.runnerDied} runner died), ${cost}`
}

const GROUP_TITLE = { repo: 'By repo', engine: 'By engine', model: 'By model' } as const

export function renderPaybackMarkdown(view: PaybackView): string {
  const lines = ['# Hangar payback', '', paybackHeadline(view)]
  if (view.totals.missions === 0) return lines.join('\n')
  if (view.totals.totalDurationMin > 0) lines.push('', `Time spent running: ${formatDuration(view.totals.totalDurationMin)}.`)
  for (const group of ['repo', 'engine', 'model'] as const) {
    const buckets = view.breakdowns[group]
    if (!buckets?.length) continue
    lines.push('', `## ${GROUP_TITLE[group]}`, ...buckets.map(bucketLine))
  }
  if (view.topCards.length) {
    lines.push('', '## Most expensive cards')
    for (const c of view.topCards) {
      const board = c.boardName ? ` (${c.boardName})` : ''
      lines.push(`- ${c.cardName}${board}: ${formatUsd(c.costKnownUsd)} over ${plural(c.missions, 'mission', 'missions')}`)
    }
  }
  return lines.join('\n')
}
