import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { aiUsage } from '@/lib/db/schema'

export type AiUsageInsert = typeof aiUsage.$inferInsert

export interface AiUsageDailyRow {
  day: string
  task: string
  providerId: string
  modelId: string
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export interface AiUsageDayTotal {
  day: string
  calls: number
  errors: number
  costUsd: number
}

export async function insertAiUsage(row: AiUsageInsert): Promise<void> {
  await db.insert(aiUsage).values(row)
}

export async function sumAiSpendSince(userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
  return Number(row?.total ?? 0)
}

export async function listAiUsageDaily(userId: string, since: Date): Promise<AiUsageDailyRow[]> {
  const day = sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt}), 'YYYY-MM-DD')`
  const rows = await db
    .select({
      day,
      task: aiUsage.task,
      providerId: aiUsage.providerId,
      modelId: aiUsage.modelId,
      calls: sql<string>`count(*)`,
      errors: sql<string>`count(*) filter (where not ${aiUsage.ok})`,
      inputTokens: sql<string>`coalesce(sum(${aiUsage.inputTokens}), 0)`,
      outputTokens: sql<string>`coalesce(sum(${aiUsage.outputTokens}), 0)`,
      cacheReadTokens: sql<string>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)`,
      cacheWriteTokens: sql<string>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)`,
      costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
    .groupBy(day, aiUsage.task, aiUsage.providerId, aiUsage.modelId)
    .orderBy(desc(day), aiUsage.task, aiUsage.modelId)
  return rows.map((r) => ({
    day: r.day,
    task: r.task,
    providerId: r.providerId,
    modelId: r.modelId,
    calls: Number(r.calls),
    errors: Number(r.errors),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    cacheReadTokens: Number(r.cacheReadTokens),
    cacheWriteTokens: Number(r.cacheWriteTokens),
    costUsd: Number(r.costUsd),
  }))
}

export function totalsByDay(rows: AiUsageDailyRow[]): AiUsageDayTotal[] {
  const byDay = new Map<string, AiUsageDayTotal>()
  for (const r of rows) {
    const t = byDay.get(r.day) ?? { day: r.day, calls: 0, errors: 0, costUsd: 0 }
    t.calls += r.calls
    t.errors += r.errors
    t.costUsd += r.costUsd
    byDay.set(r.day, t)
  }
  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day))
}
