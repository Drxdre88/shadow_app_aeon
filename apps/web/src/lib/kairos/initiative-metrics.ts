import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getConversationState } from './engagement'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

type AskMetricRow = {
  id: string
  status: string | null
  asked_at: Date | string
  answered_at: Date | string | null
  expires_at: Date | string | null
  applied: boolean
}

export type AskLoopStats = {
  dispatched: number
  answered: number
  expired: number
  medianHoursToAnswer: number | null
  appliedRate: number
  replyRate7d: number
}

function asDate(value: Date | string | null): Date | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export async function getAskLoopStats(
  userId: string,
  { days = 30 }: { days?: number } = {},
): Promise<AskLoopStats> {
  if (!Number.isFinite(days) || days <= 0) throw new RangeError('days must be greater than zero')

  const now = new Date()
  const cutoff = new Date(now.getTime() - days * DAY_MS)
  const [result, conversationState] = await Promise.all([
    db.execute(sql`
      SELECT
        question.id,
        question.source_metadata #>> '{kairosAsk,status}' AS status,
        COALESCE(
          NULLIF(question.source_metadata #>> '{kairosAsk,askedAt}', '')::timestamptz,
          question.created_at
        ) AS asked_at,
        NULLIF(question.source_metadata #>> '{kairosAsk,answeredAt}', '')::timestamptz AS answered_at,
        COALESCE(
          NULLIF(question.source_metadata #>> '{kairosAsk,expiresAt}', '')::timestamptz,
          NULLIF(question.source_metadata->>'expiresAt', '')::timestamptz
        ) AS expires_at,
        EXISTS (
          SELECT 1
          FROM memories answer
          JOIN memories synthesis
            ON synthesis.user_id = question.user_id
            AND synthesis.created_at > answer.created_at
          WHERE answer.user_id = question.user_id
            AND answer.stream_class = 'reflection'
            AND (
              answer.id::text = NULLIF(question.source_metadata #>> '{kairosAsk,answerMemoryId}', '')
              OR answer.source_metadata->>'askId' = question.id::text
              OR answer.source_metadata->>'kairosAskResponseTo' = question.id::text
            )
            AND (
              (
                synthesis.stream_class = 'cortex'
                AND synthesis.source_metadata @> jsonb_build_object(
                  'cortex', jsonb_build_object(
                    'thoughts', jsonb_build_array(
                      jsonb_build_object('sourceMemoryIds', jsonb_build_array(answer.id::text))
                    )
                  )
                )
              )
              OR
              (
                synthesis.stream_class = 'aether'
                AND synthesis.source_metadata @> jsonb_build_object(
                  'aether', jsonb_build_object(
                    'thoughts', jsonb_build_array(
                      jsonb_build_object('sourceMemoryIds', jsonb_build_array(answer.id::text))
                    )
                  )
                )
              )
            )
        ) AS applied
      FROM memories question
      WHERE question.user_id = ${userId}
        AND question.source_metadata ? 'askMine'
        AND question.source_metadata ? 'kairosAsk'
        AND COALESCE(
          NULLIF(question.source_metadata #>> '{kairosAsk,askedAt}', '')::timestamptz,
          question.created_at
        ) >= ${cutoff}
        AND COALESCE(
          NULLIF(question.source_metadata #>> '{kairosAsk,askedAt}', '')::timestamptz,
          question.created_at
        ) <= ${now}
    `),
    getConversationState(userId),
  ])

  const windowRows = (result.rows as AskMetricRow[]).filter((row) => {
    const askedAt = asDate(row.asked_at)
    return askedAt !== null && askedAt >= cutoff && askedAt <= now
  })
  const answeredRows = windowRows.filter((row) => row.status === 'answered')
  const expired = windowRows.filter((row) => {
    if (row.status === 'answered') return false
    if (row.status === 'expired') return true
    const expiresAt = asDate(row.expires_at)
    return row.status === 'pending' && expiresAt !== null && expiresAt <= now
  }).length
  const answerHours = answeredRows.flatMap((row) => {
    const askedAt = asDate(row.asked_at)
    const answeredAt = asDate(row.answered_at)
    if (!askedAt || !answeredAt || answeredAt < askedAt) return []
    return [(answeredAt.getTime() - askedAt.getTime()) / HOUR_MS]
  })
  const applied = answeredRows.filter((row) => row.applied).length

  return {
    dispatched: windowRows.length,
    answered: answeredRows.length,
    expired,
    medianHoursToAnswer: median(answerHours),
    appliedRate: answeredRows.length === 0 ? 0 : applied / answeredRows.length,
    replyRate7d: conversationState.replyRate7d,
  }
}
