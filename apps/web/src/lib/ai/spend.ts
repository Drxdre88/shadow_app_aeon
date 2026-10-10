import { after } from 'next/server'
import { insertAiUsage, sumAiSpendSince, type AiUsageInsert } from '@/lib/data/ai-usage'
import type { AIUsage } from './provider'
import { estimateCostUsd } from './spend-pricing'

export const SPEND_CAP_ERROR_NAME = 'SpendCapReached'
export const DEFAULT_DAILY_SPEND_CAP_USD = 5
export const SPEND_CACHE_TTL_MS = 30_000

export class SpendCapReached extends Error {
  readonly spentUsd: number
  readonly capUsd: number
  constructor(spentUsd: number, capUsd: number) {
    super(`daily AI budget reached: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)} spent today (UTC)`)
    this.name = SPEND_CAP_ERROR_NAME
    this.spentUsd = spentUsd
    this.capUsd = capUsd
  }
}

export function isSpendCapReached(err: unknown): err is SpendCapReached {
  return err instanceof Error && err.name === SPEND_CAP_ERROR_NAME
}

export function parseDailySpendCap(raw: string | undefined): number | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return DEFAULT_DAILY_SPEND_CAP_USD
  if (value === 'off') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_SPEND_CAP_USD
}

export function dailySpendCapUsd(): number | null {
  return parseDailySpendCap(process.env.AI_DAILY_SPEND_CAP_USD)
}

export function utcDayStart(nowMs: number): Date {
  const d = new Date(nowMs)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function utcDayKey(nowMs: number): string {
  return utcDayStart(nowMs).toISOString().slice(0, 10)
}

export interface SpendGuardDeps {
  readSpend: (userId: string, since: Date) => Promise<number>
  capUsd?: () => number | null
  now?: () => number
  ttlMs?: number
}

interface CachedSpend {
  day: string
  spent: number
  fetchedAt: number
}

export class SpendGuard {
  private readonly cache = new Map<string, CachedSpend>()
  private readonly warnedDay = new Map<string, string>()
  private readonly capUsd: () => number | null
  private readonly now: () => number
  private readonly ttlMs: number

  constructor(private readonly deps: SpendGuardDeps) {
    this.capUsd = deps.capUsd ?? dailySpendCapUsd
    this.now = deps.now ?? Date.now
    this.ttlMs = deps.ttlMs ?? SPEND_CACHE_TTL_MS
  }

  async check(userId: string): Promise<void> {
    const cap = this.capUsd()
    if (cap === null) return
    const spent = await this.spentToday(userId)
    if (spent < cap) return
    this.warnOncePerDay(userId, spent, cap)
    throw new SpendCapReached(spent, cap)
  }

  add(userId: string, costUsd: number): void {
    const hit = this.cache.get(userId)
    if (hit && hit.day === utcDayKey(this.now())) hit.spent += costUsd
  }

  private async spentToday(userId: string): Promise<number> {
    const nowMs = this.now()
    const day = utcDayKey(nowMs)
    const hit = this.cache.get(userId)
    if (hit && hit.day === day && nowMs - hit.fetchedAt < this.ttlMs) return hit.spent
    try {
      const spent = await this.deps.readSpend(userId, utcDayStart(nowMs))
      this.cache.set(userId, { day, spent, fetchedAt: nowMs })
      return spent
    } catch (err) {
      console.warn('[ai-usage] spend read failed; allowing the call', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      })
      return 0
    }
  }

  private warnOncePerDay(userId: string, spent: number, cap: number): void {
    const day = utcDayKey(this.now())
    if (this.warnedDay.get(userId) === day) return
    this.warnedDay.set(userId, day)
    console.warn('[ai-usage] daily spend cap reached; paid calls refused until UTC midnight', {
      userId,
      day,
      spentUsd: Number(spent.toFixed(4)),
      capUsd: cap,
    })
  }
}

export interface UsageEvent {
  userId: string
  task: string
  providerId: string
  modelId: string
  usage?: AIUsage
  latencyMs: number
  ok: boolean
  error?: unknown
}

function errorLabel(err: unknown): string | null {
  if (err === undefined) return null
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return text.slice(0, 200)
}

function count(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export class SpendMeter {
  constructor(
    private readonly guard: SpendGuard,
    private readonly write: (row: AiUsageInsert) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  check(userId: string): Promise<void> {
    return this.guard.check(userId)
  }

  record(event: UsageEvent): void {
    const { costUsd, priced } = estimateCostUsd(event.modelId, event.usage)
    const row: AiUsageInsert = {
      userId: event.userId,
      task: event.task.slice(0, 60),
      providerId: event.providerId.slice(0, 20),
      modelId: event.modelId.slice(0, 120),
      inputTokens: count(event.usage?.inputTokens),
      outputTokens: count(event.usage?.outputTokens),
      cacheReadTokens: count(event.usage?.cacheReadTokens),
      cacheWriteTokens: count(event.usage?.cacheWriteTokens),
      costUsd: costUsd.toFixed(6),
      latencyMs: Math.max(0, Math.round(event.latencyMs)),
      ok: event.ok,
      error: errorLabel(event.error),
      createdAt: new Date(this.now()),
    }
    console.info('[ai-usage]', JSON.stringify({
      task: row.task,
      provider: row.providerId,
      model: row.modelId,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens,
      costUsd: Number(row.costUsd),
      priced,
      ms: row.latencyMs,
      ok: row.ok,
      ...(row.error ? { error: row.error } : {}),
    }))
    this.guard.add(event.userId, costUsd)
    const pending = Promise.resolve()
      .then(() => this.write(row))
      .catch((err: unknown) => {
        console.warn('[ai-usage] usage write failed', { error: err instanceof Error ? err.message : String(err) })
      })
    // Keep the function alive until the row lands, so a request that ends right
    // after its last paid call cannot drop the spend the cap counts.
    try {
      after(() => pending)
    } catch {
      // outside a request scope (cron scripts, tests): the write still completes
    }
  }
}

export const spendMeter = new SpendMeter(new SpendGuard({ readSpend: sumAiSpendSince }), insertAiUsage)
